import { SessionFixture } from './session-fixture';
import { BootHardeningError, FLOATING_STAMP_KEY, hardenDataSource } from '../src/database/boot-hardening';
import { TeamService } from '../src/team/team.service';
import { TeamMembershipService } from '../src/team/team-membership.service';
import { TeamSystemKey } from '../src/team/team.entity';

/**
 * Endurecimento do banco no boot (RN-38 a RN-40, CA-71 a CA-76). Cria os papéis anon/authenticated com GRANT ALL, como o Supabase,
 * no Postgres descartável do e2e e remove os papéis no fim (eles são do cluster). Nunca rodar contra banco compartilhado.
 * CA-73 (sem os papéis a API sobe) é o que todas as outras suítes já fazem ao subir o app.
 */
describe('Endurecimento do banco no boot (e2e)', () => {
  let t: SessionFixture;
  let owner: string;

  const q = (sql: string, params: unknown[] = []) => t.dataSource.query(sql, params);
  const createRoles = () =>
    q(`DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
       END $$`);
  const dropRoles = async () => {
    const roles = await q(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`);
    if (roles.length) await q(`DROP OWNED BY ${roles.map((r: any) => r.rolname).join(', ')}`);
    for (const r of roles) await q(`DROP ROLE ${r.rolname}`);
  };
  /** Defaults do Supabase: tabela nova nasce com ALL para os dois papéis, no schema public e global */
  const supabaseDefaults = async () => {
    await q(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated`);
    await q(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} GRANT ALL ON TABLES TO anon`);
  };
  const tablesExposed = async () =>
    (
      await q(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
            AND (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))`,
      )
    ).map((r: any) => r.relname as string);
  const tablesWithoutRls = async () =>
    (
      await q(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity`,
      )
    ).map((r: any) => r.relname as string);
  const privilegeOn = async (table: string, role: string) => (await q(`SELECT has_table_privilege($1, $2, 'SELECT') AS allowed`, [role, `public.${table}`]))[0].allowed as boolean;
  const harden = (ds = t.dataSource) => hardenDataSource(ds);
  const eventsOf = (name: string) => t.logs.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((e) => e.event === name);

  /** DataSource que ignora o REVOKE das tabelas dadas: simula um revoke que falha e deixa o privilégio */
  const dataSourceThatCannotRevoke = (...tables: string[]) =>
    new Proxy(t.dataSource, {
      get(target, prop) {
        if (prop === 'createQueryRunner') {
          return () => {
            const runner = target.createQueryRunner();
            const original = runner.query.bind(runner);
            runner.query = (async (sql: string, ...rest: any[]) => (sql.startsWith('REVOKE') && tables.some((table) => sql.includes(`"${table}"`)) ? undefined : original(sql, ...rest))) as any;
            return runner;
          };
        }
        const value = (target as any)[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

  beforeAll(async () => {
    t = await SessionFixture.boot('77777777777783', 'Hardening Banco');
    owner = (await q('SELECT current_user AS u'))[0].u;
    await dropRoles();
    await createRoles();
    await supabaseDefaults();
  }, 60000);

  afterAll(async () => {
    await dropRoles();
    await t.close();
  }, 60000);

  it('CA-71: com GRANT ALL e RLS desligado em todas as tabelas, o boot fecha tudo, e um 2º boot não muda nada', async () => {
    await q(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated`);
    for (const { relname } of await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`)) {
      await q(`ALTER TABLE public."${relname}" DISABLE ROW LEVEL SECURITY`);
    }
    expect((await tablesExposed()).length).toBeGreaterThan(30);
    t.logs.length = 0;

    await harden();

    expect(await tablesExposed()).toEqual([]);
    expect(await tablesWithoutRls()).toEqual([]);
    const [first] = eventsOf('db_hardening.applied');
    expect(first.changed.length).toBeGreaterThan(30);
    expect(eventsOf('db_hardening.role_missing')).toHaveLength(0);
    expect(eventsOf('db_hardening.table_exposed')).toHaveLength(0);
    expect(eventsOf('db_hardening.refresh_tokens_exposed')).toHaveLength(0);

    // idempotente
    t.logs.length = 0;
    await harden();
    expect(eventsOf('db_hardening.applied')[0].changed).toEqual([]);
    expect(await tablesExposed()).toEqual([]);
    expect(await tablesWithoutRls()).toEqual([]);
  }, 60000);

  it('o grant de coluna e o de PUBLIC também saem', async () => {
    await q(`GRANT SELECT (email) ON users TO authenticated`);
    await q(`GRANT SELECT ON pets TO PUBLIC`);

    await harden();

    expect(await privilegeOn('pets', 'anon')).toBe(false);
    expect((await q(`SELECT has_any_column_privilege('authenticated', 'public.users', 'SELECT') AS a`))[0].a).toBe(false);
  });

  it('CA-72: tabela nova nasce sem privilégio (default privileges) e recebe RLS no mesmo boot', async () => {
    await supabaseDefaults(); // o Supabase reaplica os defaults a cada nova tabela
    await harden(); // passo A revoga os defaults antes do sync
    await q(`CREATE TABLE public.zz_tabela_nova (id int)`);
    try {
      // ainda antes do passo B: já nasceu fechada
      expect(await privilegeOn('zz_tabela_nova', 'anon')).toBe(false);
      expect(await privilegeOn('zz_tabela_nova', 'authenticated')).toBe(false);

      await harden();

      expect(await tablesWithoutRls()).toEqual([]);
    } finally {
      await q(`DROP TABLE public.zz_tabela_nova`);
    }
  });

  it('a tabela de manutenção e a de refresh_tokens respondem 42501 para os papéis', async () => {
    for (const table of ['refresh_tokens', 'app_maintenance']) {
      for (const role of ['anon', 'authenticated']) {
        const runner = t.dataSource.createQueryRunner();
        await runner.connect();
        try {
          await runner.query(`SET ROLE ${role}`);
          await expect(runner.query(`SELECT 1 FROM public.${table} LIMIT 1`)).rejects.toMatchObject({ code: '42501' });
          await expect(runner.query(`INSERT INTO public.${table} DEFAULT VALUES`)).rejects.toMatchObject({ code: '42501' });
        } finally {
          await runner.query('RESET ROLE');
          await runner.release();
        }
      }
    }
  });

  it('CA-74: revoke de refresh_tokens que falha impede o boot, com o log do papel e do privilégio', async () => {
    await q(`GRANT SELECT, INSERT ON refresh_tokens TO anon`);
    t.logs.length = 0;

    await expect(harden(dataSourceThatCannotRevoke('refresh_tokens'))).rejects.toBeInstanceOf(BootHardeningError);

    const [event] = eventsOf('db_hardening.refresh_tokens_exposed');
    expect(event.exposures).toEqual([
      { role: 'anon', privilege: 'SELECT' },
      { role: 'anon', privilege: 'INSERT' },
    ]);
    await harden(); // o boot normal conserta
    expect(await privilegeOn('refresh_tokens', 'anon')).toBe(false);
  });

  it('CA-74: o mesmo numa tabela comum (pets) só gera table_exposed e o boot sobe', async () => {
    await q(`GRANT SELECT ON pets TO authenticated`);
    t.logs.length = 0;

    await expect(harden(dataSourceThatCannotRevoke('pets'))).resolves.toBeUndefined();

    expect(eventsOf('db_hardening.table_exposed').map((e) => e.table)).toContain('pets');
    expect(eventsOf('db_hardening.refresh_tokens_exposed')).toHaveLength(0);
    await harden();
    expect(await privilegeOn('pets', 'authenticated')).toBe(false);
  });

  describe('CA-76: carimbo dos volantes roda uma vez só', () => {
    it('1º boot carimba os volantes com vínculo ativo, loga a contagem e grava a marca; o seguinte não faz nada', async () => {
      const floating = await t.app.get(TeamService).systemTeam(t.orgId, TeamSystemKey.FLOATING_VOLUNTEER);
      const volante = await t.createUser('Vivi Volante Carimbo');
      await t.app.get(TeamMembershipService).assign({ birthDate: null, ...volante }, floating.id, null);
      const fixo = await t.createFixed('Fabi Fixa Carimbo');
      await q(`DELETE FROM app_maintenance WHERE key = $1`, [FLOATING_STAMP_KEY]);
      await q(`UPDATE users SET password_changed_at = NULL WHERE id = ANY ($1::uuid[])`, [[volante.id, fixo.id]]);
      const changedAt = async (id: string) => (await q(`SELECT password_changed_at AS at FROM users WHERE id = $1`, [id]))[0].at as Date | null;
      t.logs.length = 0;
      const before = Date.now();

      await harden();

      const stamped = await changedAt(volante.id);
      expect(stamped).not.toBeNull();
      expect(new Date(stamped).getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(await changedAt(fixo.id)).toBeNull();
      const [event] = eventsOf('deploy.floating_sessions_stamped');
      expect(event.stamped).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(event)).not.toContain(volante.id);
      expect(await q(`SELECT 1 FROM app_maintenance WHERE key = $1`, [FLOATING_STAMP_KEY])).toHaveLength(1);

      // 2º boot: a marca segura, nada muda e nada é logado
      t.logs.length = 0;
      await t.sleep(20);
      await harden();
      expect(new Date(await changedAt(volante.id)).getTime()).toBe(new Date(stamped).getTime());
      expect(eventsOf('deploy.floating_sessions_stamped')).toHaveLength(0);
    }, 30000);
  });
});
