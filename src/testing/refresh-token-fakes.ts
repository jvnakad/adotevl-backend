import { RefreshTokenService } from '../auth/refresh-token.service';

// Peças compartilhadas pelos specs do RefreshTokenService: banco falso roteirizado por trecho de SQL (sem Postgres)
export const DAY = 86_400_000;
export const NOW = new Date('2026-10-27T12:00:00.000Z').getTime();
export const USER_ID = '7d3c0a52-5d54-4f7e-9f2b-0a7f4d6f2f10';
export const FAMILY = '3f2b8c1e-5a7d-4e9b-8c3a-1d2e3f4a5b6c';
export const USER_AGENT = 'Mozilla/5.0 (X11; Linux) AgenteSecreto/1.0';
export const subject = { id: USER_ID, email: 'ana@teste.com', profileId: 'p1', profileName: 'VOLUNTEER', organizationId: 'org-1' };
export const state = { ...subject, isActive: true, isConfirmed: true, isApproved: true, passwordChangedAt: null, systemKey: 'FIXED_VOLUNTEER' };

export type Script = {
  consume?: any[];
  classify?: any[];
  subject?: any[];
  evicted?: string[];
  revokeAffected?: number;
  failInsert?: boolean;
  failCleanup?: boolean;
  /** false = o hash do logout não existe / já estava revogado */
  logoutRow?: boolean;
};

export function build(script: Script = {}) {
  const calls: { sql: string; params: any[] }[] = [];
  const manager = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FOR NO KEY UPDATE')) return [{ '?column?': 1 }];
      if (sql.includes('token_hash = $1 AND revoked_at IS NULL')) return script.logoutRow === false ? [[], 0] : [[{ userId: USER_ID, familyId: FAMILY }], 1];
      if (sql.includes('SET used_at = now()')) return [script.consume ?? [], script.consume?.length ?? 0];
      if (sql.includes('FROM refresh_tokens WHERE token_hash')) return script.classify ?? [];
      if (sql.includes('LEFT JOIN profiles')) return script.subject ?? [];
      if (sql.includes('INSERT INTO refresh_tokens')) {
        if (script.failInsert) throw new Error('insert falhou');
        return [];
      }
      if (sql.includes('OFFSET')) return [(script.evicted ?? []).map((familyId) => ({ familyId })), (script.evicted ?? []).length];
      if (sql.includes('SET revoked_at = now() WHERE family_id')) return [[], script.revokeAffected ?? 1];
      throw new Error(`consulta inesperada: ${sql}`);
    }),
  };
  const committed: string[] = [];
  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => {
      const result = await cb(manager);
      committed.push('commit');
      return result;
    }),
    query: jest.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      if (script.failCleanup && sql.includes('DELETE FROM refresh_tokens')) throw new Error('cleanup falhou');
      if (sql.includes('token_hash = $1 AND revoked_at IS NULL')) return [[{ userId: USER_ID, familyId: FAMILY }], 1];
      return [];
    }),
  };
  const jwt = { sign: jest.fn((payload: object) => `jwt.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`) };
  const realtime = { disconnectFamily: jest.fn(async () => undefined) };
  const service = new RefreshTokenService(dataSource as any, jwt as any, realtime as any);
  return { service, manager, dataSource, jwt, realtime, calls, committed };
}

export const rowFor = (overrides: Record<string, unknown> = {}) => ({ userId: USER_ID, familyId: FAMILY, familyStartedAt: new Date(NOW - DAY), ...overrides });

