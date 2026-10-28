import { Logger } from '@nestjs/common';
import { DataSource, DataSourceOptions } from 'typeorm';
import { rowsOf } from '../common/query-result';

/**
 * Endurecimento do banco a cada boot, sem nenhum passo manual no Supabase (RN-18, RN-38 a RN-40, D-31 a D-35).
 * Ordem: A (default privileges) -> synchronize -> B (REVOKE + RLS) -> C (conferência) -> D (carimbo único dos volantes).
 * SQL idempotente; detalhe, medições e limites do que a API consegue fazer em docs/db/refresh-token.md §6.
 */

const logger = new Logger('BootHardening');
const log = (event: string, fields: Record<string, unknown> = {}, level: 'log' | 'warn' | 'error' = 'log') => logger[level](JSON.stringify({ event, ...fields }));

/** Tabela refresh_tokens acessível a anon/authenticated (ou ausente): a API não sobe. Não tenta de novo (`toRetry`). */
export class BootHardeningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootHardeningError';
  }
}

export const FLOATING_STAMP_KEY = 'esqueci-senha.rn33.floating-volunteers-stamp';
const SUPABASE_ROLES = ['anon', 'authenticated'];
const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const LOCK_TIMEOUT = '3s';

// Passo A: tabela, sequence e função nova do papel da API deixam de herdar grant de anon/authenticated (no schema public e global)
export const DEFAULT_PRIVILEGES_SQL = `
DO $$
DECLARE
  grantee text;
  obj text;
BEGIN
  FOR grantee IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    FOREACH obj IN ARRAY ARRAY['TABLES', 'SEQUENCES', 'FUNCTIONS'] LOOP
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON %s FROM %I', current_user, obj, grantee);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON %s FROM %I', current_user, obj, grantee);
    END LOOP;
  END LOOP;
END $$;`;

// Passo B (leitura): o que a API possui em public, quem ainda tem grant direto (tabela ou coluna) e se o RLS está ligado
export const EXPOSURE_SQL = `
SELECT c.relname AS "name", c.relkind AS "kind", c.relrowsecurity AS "rls",
       (SELECT string_agg(DISTINCT CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END, ', ')
          FROM (SELECT (aclexplode(c.relacl)).grantee
                UNION ALL
                SELECT (aclexplode(pa.attacl)).grantee FROM pg_attribute pa WHERE pa.attrelid = c.oid AND pa.attacl IS NOT NULL) g
          LEFT JOIN pg_roles r ON r.oid = g.grantee
         WHERE g.grantee = 0 OR r.rolname IN ('anon', 'authenticated')) AS "exposedTo"
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p', 'S')
   AND pg_has_role(c.relowner, 'USAGE')
 ORDER BY c.relname`;

// Passo C: conferência com has_table_privilege (inclui herança e PUBLIC) e has_any_column_privilege
export const VERIFY_SQL = `
SELECT c.relname AS "table",
       c.relrowsecurity AS "rls",
       c.relforcerowsecurity AS "forceRls",
       pg_has_role(c.relowner, 'USAGE') AS "owned",
       coalesce(bool_or(has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                     OR has_any_column_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')), false) AS "exposed"
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_roles r ON r.rolname IN ('anon', 'authenticated')
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p')
   AND c.relname = ANY ($1::text[])
 GROUP BY c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relowner`;

// Passo D: marca e carimbo no mesmo comando (os dois ficam ou nenhum). $1 chave | $2 new Date() do app (relógio de password_changed_at)
export const FLOATING_STAMP_SQL = `
WITH claim AS (
  INSERT INTO app_maintenance (key) VALUES ($1)
  ON CONFLICT (key) DO NOTHING
  RETURNING key
), stamped AS (
  UPDATE users u
     SET password_changed_at = $2
    FROM volunteers v
    JOIN teams t ON t.id = v.team_id
   WHERE EXISTS (SELECT 1 FROM claim)
     AND v.user_id = u.id
     AND v.is_active = true
     AND t.system_key = 'FLOATING_VOLUNTEER'
  RETURNING u.id
)
SELECT (SELECT count(*) FROM claim)::int AS claimed,
       (SELECT count(*) FROM stamped)::int AS stamped`;

type ExposureRow = { name: string; kind: string; rls: boolean; exposedTo: string | null };
type VerifyRow = { table: string; rls: boolean; forceRls: boolean; owned: boolean; exposed: boolean };

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const isLockTimeout = (error: any) => (error?.code ?? error?.driverError?.code) === '55P03';

const existingRoles = async (dataSource: DataSource) =>
  rowsOf<{ rolname: string }>(await dataSource.query(`SELECT rolname FROM pg_roles WHERE rolname = ANY ($1::text[])`, [SUPABASE_ROLES])).map((row) => row.rolname);

/** Passo B: REVOKE e RLS só onde o catálogo mostra necessidade. Tabela travada por outra sessão é pulada e tentada no próximo boot. */
async function revokeAndEnableRls(dataSource: DataSource): Promise<{ changed: string[]; skipped: string[] }> {
  const rows = rowsOf<ExposureRow>(await dataSource.query(EXPOSURE_SQL));
  const pending = rows.filter((row) => row.exposedTo || (row.kind !== 'S' && !row.rls));
  const changed: string[] = [];
  const skipped: string[] = [];
  if (!pending.length) return { changed, skipped };

  const runner = dataSource.createQueryRunner();
  try {
    await runner.connect();
    await runner.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    for (const row of pending) {
      const table = `public.${quoteIdent(row.name)}`;
      try {
        if (row.exposedTo) await runner.query(`REVOKE ALL ON ${row.kind === 'S' ? 'SEQUENCE' : 'TABLE'} ${table} FROM ${row.exposedTo}`);
        if (row.kind !== 'S' && !row.rls) await runner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        changed.push(row.name);
      } catch (error) {
        if (isLockTimeout(error)) {
          skipped.push(row.name);
        } else {
          // Não derruba o boot: a falha fechada de refresh_tokens é garantida pelo passo C. Só tabela e código, nunca o texto do erro
          log('db_hardening.step_failed', { table: row.name, code: (error as any)?.code ?? (error as any)?.driverError?.code ?? 'unknown' }, 'error');
        }
      }
    }
  } finally {
    // A conexão volta para o pool: o lock_timeout não pode vazar para as queries da API
    try {
      await runner.query('RESET lock_timeout');
    } catch {
      // conexão já quebrada: o release descarta
    }
    await runner.release();
  }
  return { changed, skipped };
}

/** Passo C. `refresh_tokens` exposta ou ausente = fatal; outras tabelas = log de erro. */
async function verify(dataSource: DataSource): Promise<void> {
  const names = dataSource.entityMetadatas.filter((meta) => (meta.schema ?? 'public') === 'public').map((meta) => meta.tableName);
  const rows = rowsOf<VerifyRow>(await dataSource.query(VERIFY_SQL, [names]));

  const critical = rows.find((row) => row.table === 'refresh_tokens');
  if (!names.includes('refresh_tokens') || !critical) throw new BootHardeningError('refresh_tokens ausente das entidades ou do banco.');
  if (critical.exposed) {
    // Só papel e privilégio, nunca valores
    const exposures: { role: string; privilege: string }[] = [];
    for (const role of await existingRoles(dataSource)) {
      for (const privilege of PRIVILEGES) {
        const [{ allowed }] = rowsOf<{ allowed: boolean }>(await dataSource.query(`SELECT has_table_privilege($1, 'public.refresh_tokens', $2) AS allowed`, [role, privilege]));
        if (allowed) exposures.push({ role, privilege });
      }
    }
    log('db_hardening.refresh_tokens_exposed', { exposures }, 'error');
    throw new BootHardeningError('refresh_tokens acessível para anon ou authenticated.');
  }

  for (const row of rows) {
    if (row.table === 'refresh_tokens') {
      if (!row.rls || row.forceRls) log('db_hardening.table_unprotected', { table: row.table, rls: row.rls, forceRls: row.forceRls }, 'error');
      continue;
    }
    const failed = [row.exposed && 'exposed', !row.rls && 'rls', row.forceRls && 'forceRls', !row.owned && 'owned'].filter(Boolean);
    if (failed.length) log('db_hardening.table_exposed', { table: row.table, failed }, 'error');
  }
}

/** Passo D: roda uma vez por banco. Erro só vai para o log; sem a marca gravada, o próximo boot tenta de novo. */
async function stampFloatingVolunteers(dataSource: DataSource): Promise<void> {
  try {
    const [result] = rowsOf<{ claimed: number; stamped: number }>(await dataSource.query(FLOATING_STAMP_SQL, [FLOATING_STAMP_KEY, new Date()]));
    if (result?.claimed === 1) log('deploy.floating_sessions_stamped', { stamped: result.stamped });
  } catch (error) {
    log('boot_maintenance.floating_stamp_failed', { reason: (error as Error).message }, 'error');
  }
}

/** Todos os passos sobre uma DataSource já iniciada (com `synchronize: false`). Não destrói a conexão. */
export async function hardenDataSource(dataSource: DataSource): Promise<void> {
  const roles = await existingRoles(dataSource);
  for (const role of SUPABASE_ROLES) if (!roles.includes(role)) log('db_hardening.role_missing', { role });

  await dataSource.query(DEFAULT_PRIVILEGES_SQL); // A
  await dataSource.synchronize(); // sync: a tabela nova já nasce sem grant, por causa do passo A
  const { changed, skipped } = await revokeAndEnableRls(dataSource); // B
  if (skipped.length) log('db_hardening.lock_timeout', { tables: skipped }, 'warn');
  log('db_hardening.applied', { tables: dataSource.entityMetadatas.length, changed });
  await verify(dataSource); // C
  await stampFloatingVolunteers(dataSource); // D
}

/**
 * `dataSourceFactory` do TypeOrmModule: cria a conexão com `synchronize: false` e roda os passos A a D antes de qualquer
 * `onModuleInit` e antes do `listen`. Com refresh_tokens exposta, destrói a conexão e lança BootHardeningError.
 */
export async function bootDataSource(options: DataSourceOptions): Promise<DataSource> {
  const dataSource = new DataSource({ ...options, synchronize: false } as DataSourceOptions);
  await dataSource.initialize();
  try {
    await hardenDataSource(dataSource);
  } catch (error) {
    await dataSource.destroy().catch(() => undefined);
    throw error;
  }
  return dataSource;
}

/** `toRetry` do TypeOrmModule: erro de exposição não tenta de novo (senão são 9 tentativas de 3 s antes de cair). */
export const retryUnlessHardeningFailed = (error: unknown) => !(error instanceof BootHardeningError);
