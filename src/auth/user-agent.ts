const USER_AGENT_MAX = 255;

/** User-Agent do request truncado em 255: vai só para a tabela de refresh, nunca para log (RN-04, SEC-14). */
export const userAgentOf = (req: { headers?: Record<string, unknown> }): string | undefined => {
  const value = req.headers?.['user-agent'];
  return typeof value === 'string' ? value.slice(0, USER_AGENT_MAX) : undefined;
};
