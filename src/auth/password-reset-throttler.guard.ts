import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttle por IP das rotas do "Esqueci minha senha" (RN-13). Responde 429 com mensagem PT-BR e só expõe `Retry-After`:
 * os contadores X-RateLimit-* mudariam a cada chamada e atrapalhariam a comparação de respostas entre contas.
 */
@Injectable()
export class PasswordResetThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(_context: ExecutionContext): Promise<void> {
    throw new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Muitas tentativas. Aguarde um minuto e tente de novo.' }, HttpStatus.TOO_MANY_REQUESTS);
  }

  protected setResponseHeader(res: any, name: string, value: string | number) {
    if (name.startsWith('Retry-After')) super.setResponseHeader(res, name, value);
  }
}
