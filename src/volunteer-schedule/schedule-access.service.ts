import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ILike, IsNull, Repository } from 'typeorm';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { ScheduleAccessCode } from './schedule-access-code.entity';
import { User } from '../user/user.entity';
import { MailService } from '../mail/mail.service';

/** Resultado do pedido de código: a LP decide o próximo passo (código, cadastro de volante ou aviso de análise). */
export type ScheduleCodeStatus = 'SENT' | 'NOT_VOLUNTEER' | 'PENDING';
const CODE_MESSAGES: Record<ScheduleCodeStatus, string> = {
  SENT: 'Enviamos um código para o seu e-mail.',
  NOT_VOLUNTEER: 'Para marcar na agenda é preciso ser voluntário.',
  PENDING: 'Seu cadastro ainda está em análise. Assim que for aprovado, você pode marcar.',
};
const codeResult = (status: ScheduleCodeStatus) => ({ status, message: CODE_MESSAGES[status] });
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const SESSION_TTL = '2h';

/** Segredo próprio: o token da agenda nunca vale como login do sistema (JwtStrategy usa JWT_SECRET puro). */
/** E-mail sem diferenciar maiúsculas (curingas do LIKE escapados) */
const emailMatch = (email: string) => ILike(String(email ?? '').trim().replace(/[\\%_]/g, (char) => `\\${char}`));

/** Último programa usado (prefill da LP). Faculdade inativa ou excluída: só o curso vem (D-10). Sem curso guardado: null. */
export const programOf = (user: User) => {
  if (!user.course) return null;
  const institution = user.institution?.isActive ? user.institution : null;
  return { institutionId: institution?.id ?? null, institutionName: institution?.name ?? null, course: user.course };
};

const sessionSecret = () => `${process.env.JWT_SECRET || 'changeme'}:schedule`;

/** Identificação de quem marca pela LP: código de 6 dígitos por e-mail → sessão de 2h só para a agenda. */
@Injectable()
export class ScheduleAccessService {
  constructor(
    @InjectRepository(ScheduleAccessCode)
    private readonly codeRepository: Repository<ScheduleAccessCode>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
  ) {}

  /** Diz se o e-mail é de voluntário (a LP oferece o cadastro de volante); o throttle da rota limita varredura. */
  async requestCode(email: string, organizationId: string, now = new Date()) {
    const user = await this.userRepository.findOne({ where: { email: emailMatch(email), organizationId } });
    if (!user) return codeResult('NOT_VOLUNTEER');
    if (!user.isApproved || !user.isActive) return codeResult('PENDING');

    await this.codeRepository.update({ userId: user.id, usedAt: IsNull() }, { usedAt: now });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.codeRepository.save(
      this.codeRepository.create({
        userId: user.id,
        codeHash: await bcrypt.hash(code, 10),
        expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000),
        attempts: 0,
      }),
    );
    await this.mailService.sendScheduleCodeEmail(user.email, user.fullName, code);
    return codeResult('SENT');
  }

  async verify(email: string, code: string, organizationId: string, now = new Date()) {
    const user = await this.userRepository.findOne({ where: { email: emailMatch(email), organizationId }, relations: { institution: true } });
    const stored = user
      ? await this.codeRepository.findOne({ where: { userId: user.id, usedAt: IsNull() }, order: { createdAt: 'DESC' } })
      : null;
    if (!stored || stored.expiresAt.getTime() < now.getTime()) throw new BadRequestException('Código expirado. Peça um novo.');
    if (stored.attempts >= MAX_ATTEMPTS) throw new BadRequestException('Muitas tentativas. Peça um novo código.');

    if (!(await bcrypt.compare(String(code ?? '').trim(), stored.codeHash))) {
      await this.codeRepository.update(stored.id, { attempts: stored.attempts + 1 });
      throw new BadRequestException('Código incorreto.');
    }

    await this.codeRepository.update(stored.id, { usedAt: now });
    const token = this.jwtService.sign(
      { sub: user.id, organizationId: user.organizationId, scope: 'schedule', codeId: stored.id },
      { secret: sessionSecret(), expiresIn: SESSION_TTL },
    );
    return { token, firstName: user.fullName.trim().split(/\s+/)[0], program: programOf(user) };
  }

  /** Header Authorization da LP → voluntário da sessão. */
  session(authorization: string | undefined) {
    const token = authorization?.replace(/^Bearer\s+/i, '');
    try {
      if (!token) throw new Error('sem token');
      const payload = this.jwtService.verify(token, { secret: sessionSecret() });
      if (payload?.scope !== 'schedule') throw new Error('escopo');
      return { userId: payload.sub as string, organizationId: payload.organizationId as string, codeId: payload.codeId as string | undefined };
    } catch {
      throw new UnauthorizedException('Sessão da agenda expirada. Peça um novo código.');
    }
  }

  /** Cada marcação pela LP exige um código novo: a sessão continua valendo para ver e desmarcar. */
  async assertCanBook(codeId: string | undefined) {
    const code = codeId ? await this.codeRepository.findOne({ where: { id: codeId } }) : null;
    if (!code || code.bookedAt) throw new UnauthorizedException('Para marcar outro horário, confirme um novo código.');
  }

  async markBooked(codeId: string, now = new Date()) {
    await this.codeRepository.update(codeId, { bookedAt: now });
  }

  /** Igual a `session`, mas sem token devolve null (GET público da agenda). */
  optionalSession(authorization: string | undefined) {
    return authorization ? this.session(authorization) : null;
  }
}
