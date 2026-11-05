import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { isPanelSessionValid } from './session-state';

const INVALID_TOKEN = 'Token inválido ou expirado.';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token não fornecido.');
    }

    const token = authHeader.split(' ')[1];

    let payload: any;
    try {
      payload = this.jwtService.verify(token, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    // Token da agenda/redefinição, sessão antes da troca de senha, família revogada, desativado e volante caem na hora (SEC-09, RN-16, RN-21, RN-32)
    if (!(await isPanelSessionValid(this.dataSource, payload))) throw new UnauthorizedException(INVALID_TOKEN);

    request.user = {
      id: payload.sub,
      email: payload.email,
      profileId: payload.profileId,
      profileName: payload.profileName,
      organizationId: payload.organizationId,
    };
    return true;
  }
}
