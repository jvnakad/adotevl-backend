import { Injectable, ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

// Libera a rota sem token; se o token for enviado, valida e preenche req.user normalmente
@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (!request.headers['authorization']) return true;
    return super.canActivate(context);
  }
}
