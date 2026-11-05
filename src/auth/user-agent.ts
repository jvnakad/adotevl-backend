const USER_AGENT_MAX = 255;

/** Único dono do corte em 255 do User-Agent: vai só para a tabela de refresh, nunca para log (RN-04, SEC-14). */
export const truncateUserAgent = (value?: string): string | null => (value ? value.slice(0, USER_AGENT_MAX) : null);

export const userAgentOf = (req: { headers?: Record<string, unknown> }): string | undefined => {
  const value = req.headers?.['user-agent'];
  return typeof value === 'string' ? truncateUserAgent(value) ?? undefined : undefined;
};
