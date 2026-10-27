import { Logger } from '@nestjs/common';
import {
  BootHardeningError,
  DEFAULT_PRIVILEGES_SQL,
  EXPOSURE_SQL,
  FLOATING_STAMP_KEY,
  FLOATING_STAMP_SQL,
  VERIFY_SQL,
  hardenDataSource,
  retryUnlessHardeningFailed,
} from './boot-hardening';

type Setup = {
  roles?: string[];
  exposure?: { name: string; kind: string; rls: boolean; exposedTo: string | null }[];
  verify?: { table: string; rls: boolean; forceRls: boolean; owned: boolean; exposed: boolean }[];
  claimed?: number;
  stampFails?: boolean;
  lockedTable?: string;
  entityTables?: string[];
};

const ok = (table: string) => ({ table, rls: true, forceRls: false, owned: true, exposed: false });

function build(setup: Setup = {}) {
  const order: string[] = [];
  const runnerCalls: string[] = [];
  const dataSource: any = {
    entityMetadatas: (setup.entityTables ?? ['refresh_tokens', 'pets']).map((tableName) => ({ tableName, schema: undefined })),
    synchronize: jest.fn(async () => void order.push('sync')),
    createQueryRunner: () => ({
      connect: async () => undefined,
      release: async () => undefined,
      query: async (sql: string) => {
        runnerCalls.push(sql);
        if (setup.lockedTable && sql.includes(`"${setup.lockedTable}"`)) throw Object.assign(new Error('lock'), { code: '55P03' });
      },
    }),
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM pg_roles WHERE rolname = ANY')) return (setup.roles ?? []).map((rolname) => ({ rolname }));
      if (sql === DEFAULT_PRIVILEGES_SQL) return void order.push('A');
      if (sql === EXPOSURE_SQL) return (order.push('B-read'), setup.exposure ?? []);
      if (sql === VERIFY_SQL) return (order.push('C'), setup.verify ?? [ok('refresh_tokens'), ok('pets')]);
      if (sql === FLOATING_STAMP_SQL) {
        order.push('D');
        if (setup.stampFails) throw new Error('falhou');
        return [{ claimed: setup.claimed ?? 1, stamped: 2 }];
      }
      if (sql.includes('has_table_privilege($1')) return [{ allowed: true }];
      throw new Error(`consulta inesperada: ${sql}`);
    }),
  };
  return { dataSource, order, runnerCalls };
}

let logs: { level: string; event: string; [key: string]: any }[];
beforeEach(() => {
  logs = [];
  for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation((m: any) => void logs.push({ level, ...JSON.parse(String(m)) }));
});
afterEach(() => jest.restoreAllMocks());

const events = () => logs.map((l) => l.event);

describe('hardenDataSource (RN-38 a RN-40)', () => {
  it('roda A, sync, B, C e D nesta ordem', async () => {
    const { dataSource, order } = build();

    await hardenDataSource(dataSource);

    expect(order).toEqual(['A', 'sync', 'B-read', 'C', 'D']);
  });

  it('sem os papéis anon e authenticated: loga role_missing para cada um e sobe', async () => {
    const { dataSource } = build({ roles: [] });

    await hardenDataSource(dataSource);

    expect(logs.filter((l) => l.event === 'db_hardening.role_missing').map((l) => l.role)).toEqual(['anon', 'authenticated']);
    expect(events()).toContain('db_hardening.applied');
  });

  it('com os dois papéis, não loga role_missing', async () => {
    const { dataSource } = build({ roles: ['anon', 'authenticated'] });

    await hardenDataSource(dataSource);

    expect(events()).not.toContain('db_hardening.role_missing');
  });

  it('B emite REVOKE só onde há grant e ENABLE RLS só onde está desligado, com identificadores entre aspas', async () => {
    const { dataSource, runnerCalls } = build({
      exposure: [
        { name: 'pets', kind: 'r', rls: false, exposedTo: 'anon, authenticated' },
        { name: 'users', kind: 'r', rls: true, exposedTo: null },
        { name: 'ok_table', kind: 'r', rls: false, exposedTo: null },
        { name: 'serial_seq', kind: 'S', rls: false, exposedTo: 'PUBLIC' },
        { name: 'weird"name', kind: 'r', rls: true, exposedTo: 'anon' },
      ],
    });

    await hardenDataSource(dataSource);

    expect(runnerCalls).toEqual([
      `SET lock_timeout = '3s'`,
      'REVOKE ALL ON TABLE public."pets" FROM anon, authenticated',
      'ALTER TABLE public."pets" ENABLE ROW LEVEL SECURITY',
      'ALTER TABLE public."ok_table" ENABLE ROW LEVEL SECURITY',
      'REVOKE ALL ON SEQUENCE public."serial_seq" FROM PUBLIC',
      'REVOKE ALL ON TABLE public."weird""name" FROM anon',
    ]);
    const applied = logs.find((l) => l.event === 'db_hardening.applied');
    expect(applied.changed).toEqual(['pets', 'ok_table', 'serial_seq', 'weird"name']);
  });

  it('boot já endurecido: nenhum comando de escrita e changed vazio (idempotente)', async () => {
    const { dataSource, runnerCalls } = build({ exposure: [{ name: 'pets', kind: 'r', rls: true, exposedTo: null }] });

    await hardenDataSource(dataSource);

    expect(runnerCalls).toEqual([]);
    expect(logs.find((l) => l.event === 'db_hardening.applied').changed).toEqual([]);
  });

  it('tabela travada por outra sessão é pulada com warn e o resto segue', async () => {
    const { dataSource, runnerCalls } = build({
      lockedTable: 'busy',
      exposure: [
        { name: 'busy', kind: 'r', rls: false, exposedTo: null },
        { name: 'pets', kind: 'r', rls: false, exposedTo: null },
      ],
    });

    await hardenDataSource(dataSource);

    expect(runnerCalls).toContain('ALTER TABLE public."pets" ENABLE ROW LEVEL SECURITY');
    expect(logs.find((l) => l.event === 'db_hardening.lock_timeout')).toEqual({ level: 'warn', event: 'db_hardening.lock_timeout', tables: ['busy'] });
    expect(logs.find((l) => l.event === 'db_hardening.applied').changed).toEqual(['pets']);
  });

  describe('passo C (RN-39)', () => {
    it('refresh_tokens exposta: log refresh_tokens_exposed (papel e privilégio) e BootHardeningError; D não roda', async () => {
      const { dataSource, order } = build({ roles: ['anon'], verify: [{ ...ok('refresh_tokens'), exposed: true }, ok('pets')] });

      await expect(hardenDataSource(dataSource)).rejects.toBeInstanceOf(BootHardeningError);

      const event = logs.find((l) => l.event === 'db_hardening.refresh_tokens_exposed');
      expect(event.level).toBe('error');
      expect(event.exposures).toEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((privilege) => ({ role: 'anon', privilege })));
      expect(order).not.toContain('D');
    });

    it('refresh_tokens ausente do banco ou das entidades é fatal', async () => {
      await expect(hardenDataSource(build({ verify: [ok('pets')] }).dataSource)).rejects.toBeInstanceOf(BootHardeningError);
      await expect(hardenDataSource(build({ entityTables: ['pets'], verify: [ok('pets')] }).dataSource)).rejects.toBeInstanceOf(BootHardeningError);
    });

    it('outra tabela exposta: log table_exposed e a API sobe (o carimbo roda)', async () => {
      const { dataSource, order } = build({ verify: [ok('refresh_tokens'), { ...ok('pets'), exposed: true, rls: false }] });

      await hardenDataSource(dataSource);

      expect(logs.find((l) => l.event === 'db_hardening.table_exposed')).toEqual({ level: 'error', event: 'db_hardening.table_exposed', table: 'pets', failed: ['exposed', 'rls'] });
      expect(order).toContain('D');
    });

    it('tabela de outro dono: table_exposed com owned', async () => {
      const { dataSource } = build({ verify: [ok('refresh_tokens'), { ...ok('pets'), owned: false }] });

      await hardenDataSource(dataSource);

      expect(logs.find((l) => l.event === 'db_hardening.table_exposed').failed).toEqual(['owned']);
    });

    it('os logs nunca levam URL, senha nem chave', async () => {
      process.env.DATABASE_URL = 'postgresql://u:senhaSecreta@host/db';
      const { dataSource } = build({ roles: ['anon'], verify: [ok('refresh_tokens'), { ...ok('pets'), exposed: true }] });

      await hardenDataSource(dataSource);

      expect(JSON.stringify(logs)).not.toContain('senhaSecreta');
      delete process.env.DATABASE_URL;
    });
  });

  describe('passo D: carimbo único dos volantes (RN-40)', () => {
    it('1ª vez (claimed 1): grava a chave certa, usa o relógio do app e loga a contagem sem ids', async () => {
      const { dataSource } = build({ claimed: 1 });

      await hardenDataSource(dataSource);

      const call = dataSource.query.mock.calls.find(([sql]) => sql === FLOATING_STAMP_SQL);
      expect(call[1][0]).toBe(FLOATING_STAMP_KEY);
      expect(call[1][1]).toBeInstanceOf(Date);
      expect(logs.find((l) => l.event === 'deploy.floating_sessions_stamped')).toEqual({ level: 'log', event: 'deploy.floating_sessions_stamped', stamped: 2 });
    });

    it('boot seguinte (claimed 0): não loga', async () => {
      const { dataSource } = build({ claimed: 0 });

      await hardenDataSource(dataSource);

      expect(events()).not.toContain('deploy.floating_sessions_stamped');
    });

    it('erro no carimbo só vai para o log e a API sobe', async () => {
      const { dataSource } = build({ stampFails: true });

      await expect(hardenDataSource(dataSource)).resolves.toBeUndefined();

      expect(logs.find((l) => l.event === 'boot_maintenance.floating_stamp_failed').level).toBe('error');
    });
  });
});

describe('retryUnlessHardeningFailed', () => {
  it('BootHardeningError não tenta de novo; o resto sim', () => {
    expect(retryUnlessHardeningFailed(new BootHardeningError('x'))).toBe(false);
    expect(retryUnlessHardeningFailed(new Error('conexão'))).toBe(true);
  });
});
