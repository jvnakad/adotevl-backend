import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessLevel, hasLevel, SCREEN_BY_KEY } from './access';
import { ACCESS_KEY, ADMIN_ONLY_KEY, RequiredAccess } from './access.decorator';
import { AccessService } from './access.service';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessService: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<RequiredAccess>(ACCESS_KEY, targets);
    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, targets);
    if (!required && !adminOnly) return true;

    const request = context.switchToHttp().getRequest();
    // Lido do banco a cada requisição: mudança de equipe/permissão vale na hora
    const access = await this.accessService.forUser(request.user?.id);
    if (!access) throw new ForbiddenException('Seu usuário não está em nenhuma equipe. Fale com um administrador.');
    request.access = access;

    if (access.isAdmin) return true;
    if (adminOnly) throw new ForbiddenException('Ação permitida só para a equipe Admin.');

    const granted = access.permissions[required.screen];
    if (hasLevel(granted, required.level)) return true;
    const label = SCREEN_BY_KEY[required.screen].label;
    throw new ForbiddenException(
      granted === AccessLevel.VIEW ? `Sua equipe só pode visualizar ${label}.` : `Sua equipe não tem acesso a ${label}.`,
    );
  }
}
