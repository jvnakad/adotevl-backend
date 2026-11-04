/**
 * Origens que podem chamar a API pelo navegador (HTTP e websocket), de CORS_ORIGINS separadas por virgula.
 * Cada ambiente define a sua lista (homolog e producao). A barra final e removida, porque o
 * cabecalho Origin do navegador nunca a tem. Sem a variavel (ou vazia) devolve null: qualquer origem,
 * como era antes, para nenhum ambiente quebrar enquanto a lista nao for configurada.
 */
export function allowedOrigins(value = process.env.CORS_ORIGINS): string[] | null {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return origins.length ? origins : null;
}

/**
 * Callback de `origin` do CORS (Express e Socket.IO). Lido a cada pedido, porque o decorator do
 * gateway roda antes do ConfigModule carregar o .env. Pedido sem Origin (servidor, webhook, curl)
 * passa: CORS so protege o navegador.
 */
export function corsOrigin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
  const allowed = allowedOrigins();
  callback(null, !origin || !allowed || allowed.includes(origin));
}
