import {
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

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly accessService: AccessService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async login(dto: LoginDto, userAgent?: string) {
    const user = await this.userService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Usuário inativo.');
    }

    if (!user.isConfirmed) {
      throw new UnauthorizedException('Conta não confirmada. Verifique seu e-mail.');
    }

    if (!user.isApproved) {
      throw new UnauthorizedException('Conta aguardando aprovação do administrador.');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatch) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // Volante não usa o painel. Só depois da senha certa, para não abrir um canal de enumeração (RN-26)
    if (await this.accessService.isFloatingVolunteer(user.id)) {
      throw new UnauthorizedException('Credenciais inválidas.');
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
