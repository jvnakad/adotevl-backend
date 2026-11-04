/** Origens liberadas quando CORS_ORIGINS nao esta definida: front e LP locais (Vite e Astro). */
export const LOCAL_ORIGINS = ['http://localhost:5173', 'http://localhost:4321'];

/**
 * Origens que podem chamar a API pelo navegador (HTTP e websocket), de CORS_ORIGINS separadas por virgula.
 * Cada ambiente define a sua lista (homolog e producao). A barra final e removida, porque o
 * cabecalho Origin do navegador nunca a tem. Sem a variavel (ou vazia), vale so o ambiente local:
 * com credentials ligado, nunca se libera qualquer origem.
 */
export function allowedOrigins(value = process.env.CORS_ORIGINS): string[] {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return origins.length ? origins : LOCAL_ORIGINS;
}

/**
 * Callback de `origin` do CORS (Express e Socket.IO). Lido a cada pedido, porque o decorator do
 * gateway roda antes do ConfigModule carregar o .env. Pedido sem Origin (servidor, webhook, curl)
 * passa: CORS so protege o navegador.
 */
export function corsOrigin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
  callback(null, !origin || allowedOrigins().includes(origin));
}

/** Opções de CORS da API e do Socket.IO: allowlist explícita e credenciais (cookie do refresh, fase 2 do SEC-23). */
export const corsOptions = { origin: corsOrigin, credentials: true };
