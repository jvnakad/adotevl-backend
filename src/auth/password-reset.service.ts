import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { User } from '../user/user.entity';
import { AccessService } from '../access/access.service';
import { MailService } from '../mail/mail.service';
import { RealtimeService } from '../realtime/realtime.service';
import { closePendingEmailChange } from '../user/email-change-pending';
import { jwtSecret } from './jwt-secret';
import {
  PASSWORD_RESET_CODE_TTL_MINUTES,
  PASSWORD_RESET_COOLDOWN_SECONDS,
  PASSWORD_RESET_LOCK_HOURS,
  PASSWORD_RESET_MAX_ATTEMPTS,
  PASSWORD_RESET_MAX_FAILURES_PER_DAY,
  PASSWORD_RESET_MAX_PER_DAY,
  PASSWORD_RESET_MAX_PER_HOUR,
  PASSWORD_RESET_RETENTION_DAYS,
  PASSWORD_RESET_TOKEN_TTL_MINUTES,
} from './password-reset-code.entity';

export const FORGOT_PASSWORD_MESSAGE = 'Se este e-mail tiver acesso ao painel, enviamos um código. Confira a caixa de entrada e o spam.';
export const INVALID_CODE_MESSAGE = 'Código inválido ou expirado.';
export const EXPIRED_REQUEST_MESSAGE = 'Este pedido expirou. Comece de novo.';
export const PASSWORD_CHANGED_MESSAGE = 'Senha alterada com sucesso.';

const RESET_SCOPE = 'password-reset';
/** Id que nunca existe: o caminho sem conta faz as mesmas consultas do caminho com conta */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Hash fixo (de um valor aleatório descartado): `verify` gasta o mesmo bcrypt quando não há conta ou código */
const DUMMY_HASH = '$2b$10$UgLJdAttDLXnaS282KGFSudEwx9Bot5fe/elrQKLOyyynRG7lp6lG';

/** Segredo próprio do token: ele nunca vale como sessão do painel nem da agenda (RN-15). */
const resetSecret = () => `${jwtSecret()}:password-reset`;

/** O driver pg devolve `[linhas, afetadas]` para UPDATE/DELETE e só as linhas para SELECT/INSERT. */
const rowsOf = <T>(result: unknown): T[] => (Array.isArray((result as unknown[])[0]) ? ((result as unknown[])[0] as T[]) : (result as T[]));
const affectedOf = (result: unknown): number => ((result as unknown[])[1] as number) ?? 0;

type BlockReason = 'cooldown' | 'hora' | 'dia' | 'bloqueio';

/**
 * "Esqueci minha senha": pedir código → validar código → gravar a nova senha (docs/specs/esqueci-senha.md).
 * Limites e consumo do código são condicionais no banco (UPDATE ... WHERE), com o relógio do Postgres.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly access: AccessService,
    private readonly mailService: MailService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Responde igual para qualquer e-mail. O trabalho síncrono é o mesmo em todos os casos (busca + um bcrypt.hash,
   * real ou descartado); limites, gravação do código e e-mail só acontecem para elegível, depois da resposta (RN-02).
   */
  async requestCode(email: string, ip: string) {
    const user = await this.findByEmail(email);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await bcrypt.hash(code, 10);
    setImmediate(() => {
      this.issueCode(user, code, codeHash, ip).catch((error) => this.logger.error(`Falha ao processar o pedido de código: ${(error as Error).message}`));
    });
    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  /** Só dois resultados: `{ resetToken }` ou 400 com a mesma mensagem, qualquer que seja o motivo (RN-12). */
  async verifyCode(email: string, code: string) {
    const user = await this.findByEmail(email);
    let hash = DUMMY_HASH;
    let counted: { id: string; attempts: number } | null = null;

    // Mesmas idas ao banco para qualquer e-mail (SEC-03): sem conta ou não elegível, elas rodam contra um id que não existe
    const flagsOk = !!user && user.isActive && user.isConfirmed && user.isApproved;
    const lookupId = user?.id ?? NIL_UUID;
    const hasTeam = !!(await this.access.forUser(lookupId));
    const floating = await this.access.isFloatingVolunteer(lookupId);
    const subjectId = flagsOk && hasTeam && !floating ? user.id : NIL_UUID;
    const attempt = await this.countAttempt(subjectId);
    if (attempt && subjectId !== NIL_UUID) {
      hash = attempt.codeHash;
      counted = { id: attempt.id, attempts: attempt.attempts };
    }

    // Sempre um bcrypt.compare, inclusive sem conta ou sem código (tempo igual)
    const matches = await bcrypt.compare(code, hash);

    if (!counted || !matches) {
      await this.registerFailure(subjectId, counted);
      throw new BadRequestException(INVALID_CODE_MESSAGE);
    }

    // Consumo condicional: duas validações simultâneas do mesmo código geram no máximo 1 token (RN-39)
    const consumed = await this.dataSource.query(
      'UPDATE password_reset_codes SET verified_at = now(), used_at = now() WHERE id = $1 AND verified_at IS NULL AND used_at IS NULL',
      [counted.id],
    );
    if (!affectedOf(consumed)) throw new BadRequestException(INVALID_CODE_MESSAGE);

    const resetToken = this.jwtService.sign(
      { sub: user.id, codeId: counted.id, scope: RESET_SCOPE },
      { secret: resetSecret(), algorithm: 'HS256', expiresIn: `${PASSWORD_RESET_TOKEN_TTL_MINUTES}m` },
    );
    return { resetToken };
  }

  async resetPassword(resetToken: string, password: string, ip: string) {
    const { userId, codeId } = this.readToken(resetToken);
    const user = await this.users.createQueryBuilder('user').where('user.id = :id', { id: userId }).getOne();
    // Virou volante, foi desativado... entre validar o código e gravar a senha (RN-06)
    if (!user || !(await this.isEligible(user))) throw new BadRequestException(EXPIRED_REQUEST_MESSAGE);

    // Hash antes da transação: o bcrypt não segura o lock da linha
    const hash = await bcrypt.hash(password, 10);

    await this.dataSource.transaction(async (manager) => {
      // Uso único e vínculo com o código (RN-16): só o código mais recente da conta, validado há no máximo 10 min
      const claimed = await manager.query(
        `UPDATE password_reset_codes c SET password_reset_at = now()
          WHERE c.id = $1 AND c.user_id = $2
            AND c.verified_at IS NOT NULL AND c.password_reset_at IS NULL
            AND c.verified_at > now() - ($3::int * interval '1 minute')
            AND NOT EXISTS (SELECT 1 FROM password_reset_codes n WHERE n.user_id = c.user_id AND n.created_at > c.created_at)`,
        [codeId, userId, PASSWORD_RESET_TOKEN_TTL_MINUTES],
      );
      if (!affectedOf(claimed)) throw new BadRequestException(EXPIRED_REQUEST_MESSAGE);
      await manager.query('UPDATE users SET password = $1, password_changed_at = $2 WHERE id = $3', [hash, new Date(), userId]);
      await manager.query('UPDATE password_reset_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
      await closePendingEmailChange(manager, userId, 'troca_de_senha');
    });

    await this.realtime.disconnectUser(userId);
    this.log('password_reset.completed', { userId, ip });
    void this.mailService.sendPasswordChangedEmail(user.email, user.fullName).catch((error) => this.logger.error(`Falha ao enviar o aviso de senha alterada: ${(error as Error).message}`));
    return { message: PASSWORD_CHANGED_MESSAGE };
  }

  /** E-mail sem diferenciar maiúsculas. Mais de uma conta casando = não elegível (RN-03 a). */
  private async findByEmail(email: string): Promise<User | null> {
    const matches = await this.users.createQueryBuilder('user').where('lower(user.email) = :email', { email: String(email ?? '').trim().toLowerCase() }).getMany();
    if (matches.length > 1) this.log('password_reset.requested', { eligible: false, reason: 'duplicate_email' });
    return matches.length === 1 ? matches[0] : null;
  }

  /** Quem passaria no login e tem equipe ativa que não é a Voluntário Volante (RN-03). */
  private async isEligible(user: User) {
    if (!user.isActive || !user.isConfirmed || !user.isApproved) return false;
    if (!(await this.access.forUser(user.id))) return false;
    return !(await this.access.isFloatingVolunteer(user.id));
  }

  /** Parte do pedido que só existe para elegível: roda depois da resposta, com `catch` no chamador. */
  private async issueCode(user: User | null, code: string, codeHash: string, ip: string) {
    if (!user || !(await this.isEligible(user))) {
      this.log('password_reset.requested', { eligible: false, ip });
      return;
    }

    const blocked = await this.dataSource.transaction(async (manager): Promise<BlockReason | null> => {
      // Trava por conta: dois pedidos simultâneos não mandam dois e-mails (RN-11)
      const [{ locked }] = await manager.query('SELECT coalesce(password_reset_locked_until > now(), false) AS "locked" FROM users WHERE id = $1 FOR NO KEY UPDATE', [user.id]);
      if (locked) return 'bloqueio';

      const [window] = await manager.query(
        `SELECT coalesce(max(created_at) > now() - ($2::int * interval '1 second'), false) AS "cooldown",
                count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS "lastHour",
                count(*)::int AS "lastDay"
           FROM password_reset_codes
          WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
        [user.id, PASSWORD_RESET_COOLDOWN_SECONDS],
      );
      // Dentro do cooldown não fecha o código atual (RN-10)
      if (window.cooldown) return 'cooldown';
      if (window.lastHour >= PASSWORD_RESET_MAX_PER_HOUR) return 'hora';
      if (window.lastDay >= PASSWORD_RESET_MAX_PER_DAY) return 'dia';

      // Só o último código vale (RN-09)
      await manager.query('UPDATE password_reset_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
      await manager.query(`INSERT INTO password_reset_codes (user_id, code_hash, expires_at) VALUES ($1, $2, now() + ($3::int * interval '1 minute'))`, [
        user.id,
        codeHash,
        PASSWORD_RESET_CODE_TTL_MINUTES,
      ]);
      return null;
    });

    if (blocked) {
      this.log('password_reset.blocked', { userId: user.id, reason: blocked }, 'warn');
      return;
    }

    this.log('password_reset.requested', { userId: user.id, ip });
    // Depois do commit: falha de envio não desfaz o código, que continua contando no limite
    await this.mailService.sendPasswordResetCodeEmail(user.email, user.fullName, code);
    await this.cleanup();
  }

  /** Retenção de 7 dias (RN-40). Falha só vai para o log. */
  private async cleanup() {
    try {
      await this.dataSource.query(`DELETE FROM password_reset_codes WHERE created_at < now() - ($1::int * interval '1 day')`, [PASSWORD_RESET_RETENTION_DAYS]);
    } catch (error) {
      this.logger.error(`Falha na limpeza dos códigos antigos: ${(error as Error).message}`);
    }
  }

  /** Tentativa contada antes do compare, de forma atômica; conta bloqueada também recusa (RN-38). */
  private async countAttempt(userId: string): Promise<{ id: string; codeHash: string; attempts: number } | null> {
    const [latest] = await this.dataSource.query('SELECT id FROM password_reset_codes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
    // Sem código, o UPDATE roda contra um id que não existe: mesmo número de consultas
    const result = await this.dataSource.query(
      `UPDATE password_reset_codes c SET attempts = c.attempts + 1
         FROM users u
        WHERE c.id = $1 AND u.id = c.user_id
          AND c.used_at IS NULL AND c.expires_at > now() AND c.attempts < $2
          AND (u.password_reset_locked_until IS NULL OR u.password_reset_locked_until <= now())
        RETURNING c.id AS "id", c.code_hash AS "codeHash", c.attempts AS "attempts"`,
      [latest?.id ?? NIL_UUID, PASSWORD_RESET_MAX_ATTEMPTS],
    );
    return rowsOf<{ id: string; codeHash: string; attempts: number }>(result)[0] ?? null;
  }

  /** Código errado: registra e, se a conta chegou a 15 falhas em 24 h, bloqueia por 24 h (RN-31). */
  private async registerFailure(userId: string, counted: { id: string; attempts: number } | null) {
    if (counted) this.log('password_reset.verify_failed', { codeId: counted.id, attempts: counted.attempts }, 'warn');
    const locked = await this.dataSource.query(
      `UPDATE users SET password_reset_locked_until = now() + ($2::int * interval '1 hour')
        WHERE id = $1
          AND (password_reset_locked_until IS NULL OR password_reset_locked_until <= now())
          AND (SELECT coalesce(sum(attempts - (verified_at IS NOT NULL)::int), 0)
                 FROM password_reset_codes
                WHERE user_id = $1 AND created_at > now() - interval '24 hours') >= $3
        RETURNING id`,
      [userId, PASSWORD_RESET_LOCK_HOURS, PASSWORD_RESET_MAX_FAILURES_PER_DAY],
    );
    if (counted && rowsOf(locked).length) this.log('password_reset.locked', { userId }, 'warn');
  }

  /** Token de redefinição: HS256, segredo e escopo próprios, `sub` e `codeId` obrigatórios (RN-15). */
  private readToken(resetToken: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(resetToken, { secret: resetSecret(), algorithms: ['HS256'] });
    } catch {
      throw new BadRequestException(EXPIRED_REQUEST_MESSAGE);
    }
    if (payload?.scope !== RESET_SCOPE || typeof payload.sub !== 'string' || !UUID.test(payload.sub) || typeof payload.codeId !== 'string' || !UUID.test(payload.codeId)) {
      throw new BadRequestException(EXPIRED_REQUEST_MESSAGE);
    }
    return { userId: payload.sub as string, codeId: payload.codeId as string };
  }

  /** Log de segurança estruturado: nunca código, token, senha nem e-mail em claro (RN-34). */
  private log(event: string, fields: Record<string, unknown>, level: 'log' | 'warn' = 'log') {
    this.logger[level](JSON.stringify({ event, ...fields }));
  }
}
