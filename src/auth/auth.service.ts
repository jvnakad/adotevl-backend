import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UserService } from '../user/user.service';
import { LoginDto } from './dto/login.dto';
import { AccessService } from '../access/access.service';
import { RefreshTokenService } from './refresh-token.service';
import { panelTokenSubjectOf } from './panel-token';
import { LoginLockout } from './login-lockout';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly accessService: AccessService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  // Bloqueio por conta após falhas seguidas, independente do IP (em memória: ver login-lockout.ts)
  private readonly lockout = new LoginLockout();

  async login(dto: LoginDto, userAgent?: string) {
    const retryAfter = this.lockout.retryAfterSeconds(dto.email);
    if (retryAfter > 0) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: `Muitas tentativas de login para esta conta. Tente novamente em ${Math.ceil(retryAfter / 60)} minuto(s).` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.userService.findByEmail(dto.email);

    if (!user) {
      this.lockout.recordFailure(dto.email);
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Usuário inativo.');
    }

    if (!user.isConfirmed) {
      // Com a senha certa, reenvia o e-mail de confirmação (cooldown de 60 s); com a errada, não envia nada
      const passwordOk = await bcrypt.compare(dto.password, user.password);
      if (!passwordOk) this.lockout.recordFailure(dto.email);
      const sent = passwordOk && (await this.userService.resendConfirmation(user.id).catch(() => false));
      throw new UnauthorizedException(sent ? 'Conta não confirmada. Enviamos um novo e-mail de confirmação.' : 'Conta não confirmada. Verifique seu e-mail.');
    }

    if (!user.isApproved) {
      throw new UnauthorizedException('Conta aguardando aprovação do administrador.');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatch) {
      this.lockout.recordFailure(dto.email);
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    this.lockout.recordSuccess(dto.email);

    // Volante não usa o painel. Só depois da senha certa, para não abrir um canal de enumeração (RN-26)
    // Só quem acertou a senha chega aqui, então a orientação não revela nada a terceiros (diverge do texto genérico da ES/RN-26 por decisão do produto)
    if (await this.accessService.isFloatingVolunteer(user.id)) {
      throw new UnauthorizedException('Voluntários volantes não usam o painel. Marque seus horários pela página de voluntariado no site da Adote.');
    }

    // Depois de todas as recusas: volante e senha errada nunca gravam refresh (CA-05)
    const { access_token, refresh_token } = await this.refreshTokens.issue(panelTokenSubjectOf(user), userAgent);

    return {
      access_token,
      refresh_token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        profileId: user.profileId,
        organizationId: user.organizationId,
      },
    };
  }

  async me(userId: string) {
    const user = await this.userService.findOne(userId);
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const { password, confirmationCode, ...result } = user;
    // Equipe e permissões por tela: o front monta menu, rotas e botões com elas
    return { ...result, access: await this.accessService.forUser(userId) };
  }
}
