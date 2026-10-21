import { Injectable, NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

/** Contexto da requisição HTTP em andamento (lido pelos services sem precisar passar por parâmetro). */
export interface RequestContext {
  /** Identificador do cliente (aba do navegador) enviado no header X-Client-Id; ecoado nos eventos em tempo real para ele ignorar o próprio eco */
  clientId: string | null;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
export const currentClientId = () => requestContext.getStore()?.clientId ?? null;

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;

@Injectable()
export class ClientIdMiddleware implements NestMiddleware {
  use(req: { headers: Record<string, string | string[] | undefined> }, _res: unknown, next: () => void) {
    const header = req.headers['x-client-id'];
    const value = Array.isArray(header) ? header[0] : header;
    requestContext.run({ clientId: value && CLIENT_ID_PATTERN.test(value) ? value : null }, next);
  }
}
