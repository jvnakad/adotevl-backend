/** O driver pg devolve `[linhas, afetadas]` para UPDATE/DELETE e só as linhas para SELECT/INSERT. */
export const rowsOf = <T>(result: unknown): T[] => (Array.isArray((result as unknown[])[0]) ? ((result as unknown[])[0] as T[]) : (result as T[]));
export const affectedOf = (result: unknown): number => ((result as unknown[])[1] as number) ?? 0;
