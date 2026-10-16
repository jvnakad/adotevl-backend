import { BadRequestException, Injectable, MiddlewareConsumer, Module, NestMiddleware, NestModule, RequestMethod } from '@nestjs/common';

export const NULL_BYTE_MESSAGE = 'O texto enviado contém caracteres inválidos (byte nulo).';

/** Procura o byte nulo (\u0000) em textos e chaves, em qualquer profundidade. O Postgres recusa esse caractere e a API responderia 500. */
export function containsNullByte(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 20 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsNullByte(item, depth + 1));
  return Object.entries(value).some(([key, item]) => key.includes('\u0000') || containsNullByte(item, depth + 1));
}

/** Rejeita com 400 qualquer requisição cuja query string ou corpo JSON traga o byte nulo. Não altera nenhum valor válido. */
@Injectable()
export class NullByteMiddleware implements NestMiddleware {
  use(req: { query?: unknown; body?: unknown }, _res: unknown, next: () => void) {
    if (containsNullByte(req.query) || containsNullByte(req.body)) throw new BadRequestException(NULL_BYTE_MESSAGE);
    next();
  }
}

@Module({})
export class NullByteModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NullByteMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
