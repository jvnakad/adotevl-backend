import { CanActivate, ExecutionContext, Injectable, UnsupportedMediaTypeException } from '@nestjs/common';

/**
 * Só `application/json` (com ou sem `; charset=...`) em /auth/refresh e /auth/logout. Roda antes do DTO e não lê o corpo:
 * um form urlencoded vindo de outro site não rotaciona nem revoga nada, e a fase 2 (cookie) não nasce com esse vetor de CSRF (SEC-BUG-03, SEC-07, SEC-23).
 */
@Injectable()
export class JsonContentTypeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest().headers?.['content-type'];
    const mediaType = typeof header === 'string' ? header.split(';')[0].trim().toLowerCase() : '';
    if (mediaType !== 'application/json') throw new UnsupportedMediaTypeException('Content-Type deve ser application/json.');
    return true;
  }
}
