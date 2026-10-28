import { Logger } from '@nestjs/common';
import { AccessMigrationService } from './access-migration.service';

const ORG = 'org-1';
const user = (id: string, profileName: string, teamId: string | null = null) => ({ id, fullName: id, cpf: '1', birthDate: null, organizationId: ORG, profileName, teamId });

type Setup = { migratedAt?: Date | null; hasTeams?: boolean; users?: ReturnType<typeof user>[]; readFails?: boolean; oldTeams?: { id: string }[] };

function build(setup: Setup = {}) {
  const order: string[] = [];
  const dataSource = {
    query: jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('SELECT id FROM organizations')) return [{ id: ORG }];
      if (sql.includes('access_migrated_at AS')) {
        order.push('read-mark');
        if (setup.readFails) throw new Error('db fora');
        return [{ migratedAt: setup.migratedAt ?? null }];
      }
      if (sql.includes('SELECT EXISTS')) {
        order.push('count-teams');
        return [{ hasTeams: setup.hasTeams ?? false }];
      }
      if (sql.includes('UPDATE organizations SET access_migrated_at')) {
        order.push('mark');
        return [[], 1];
      }
      if (sql.includes('FROM users u')) return setup.users ?? [];
      if (sql.includes('access_configured_at IS NULL')) return setup.oldTeams ?? [];
      if (sql.includes('FROM teams WHERE organization_id = $1 AND name')) return [];
      throw new Error(`consulta inesperada: ${sql}`);
    }),
  };
  const teams = {
    ensureAdminTeam: jest.fn(async () => {
      order.push('ensureAdminTeam');
      return { id: 't-admin' };
    }),
    ensureDefaultTeams: jest.fn(async () => {
      order.push('ensureDefaultTeams');
    }),
    create: jest.fn(async ({ name }) => ({ id: `t-${name}` })),
    setPermissions: jest.fn(async () => undefined),
  };
  const membership = {
    assign: jest.fn(async (..._args: any[]) => {
      order.push('assign');
    }),
  };
  const service = new AccessMigrationService(dataSource as any, teams as any, membership as any);
  return { service, dataSource, teams, membership, order };
}

const logged: { level: string; message: string }[] = [];
beforeEach(() => {
  logged.length = 0;
  for (const level of ['log', 'warn'] as const) jest.spyOn(Logger.prototype, level).mockImplementation((m: any) => void logged.push({ level, message: String(m) }));
});
afterEach(() => jest.restoreAllMocks());

const markUpdates = (dataSource: { query: jest.Mock }) => dataSource.query.mock.calls.filter(([sql]) => String(sql).includes('UPDATE organizations SET access_migrated_at'));
const events = () => logged.filter((l) => l.message.startsWith('{')).map((l) => JSON.parse(l.message));

// Aprovados sem vínculo de cada perfil e um ADMIN de fora: o pior caso do AB-12
const orphans = [user('admin-orfao', 'ADMIN'), user('financeiro-orfao', 'FINANCIAL'), user('fixo-orfao', 'VOLUNTEER')];

describe('AccessMigrationService (marca access_migrated_at, RN-33, SEC-16)', () => {
  it('marca preenchida: ninguém é atribuído por perfil, mas a equipe Admin e as padrão continuam garantidas', async () => {
    const { service, membership, teams, dataSource } = build({ migratedAt: new Date(), hasTeams: true, users: orphans });

    await service.onModuleInit();

    expect(membership.assign).not.toHaveBeenCalled();
    expect(markUpdates(dataSource)).toHaveLength(0);
    expect(teams.ensureAdminTeam).toHaveBeenCalledWith(ORG);
    expect(teams.ensureDefaultTeams).toHaveBeenCalledWith(ORG);
    expect(events().some((e) => e.event === 'access_migration.marked_without_assignment')).toBe(false);
  });

  it('marca nula com equipes (organização já em produção): grava a marca sem atribuir ninguém e loga o evento', async () => {
    const { service, membership, dataSource } = build({ hasTeams: true, users: orphans });

    await service.onModuleInit();

    expect(membership.assign).not.toHaveBeenCalled();
    expect(markUpdates(dataSource)).toHaveLength(1);
    expect(events()).toContainEqual({ event: 'access_migration.marked_without_assignment', organizationId: ORG });
  });

  it('(a) equipe Admin vazia com um usuário ADMIN de fora: ninguém entra na Admin', async () => {
    const { service, membership } = build({ hasTeams: true, users: [user('admin-orfao', 'ADMIN'), user('fixo', 'VOLUNTEER', 't-fixo')] });

    await service.onModuleInit();

    expect(membership.assign).not.toHaveBeenCalled();
  });

  it('(b) aprovado sem vínculo de cada perfil: ninguém é atribuído', async () => {
    const { service, membership } = build({ hasTeams: true, users: orphans });

    await service.onModuleInit();

    expect(membership.assign).not.toHaveBeenCalled();
  });

  it('(c) todas as equipes inativas contam como equipes (AB-12): só marca, e o ensureAdminTeam e as padrão seguem', async () => {
    // A contagem não filtra is_active: a consulta é a mesma e devolve true
    const { service, membership, teams, dataSource } = build({ hasTeams: true, users: orphans });

    await service.onModuleInit();

    const countSql = dataSource.query.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes('SELECT EXISTS'))!;
    expect(countSql).not.toContain('is_active');
    expect(membership.assign).not.toHaveBeenCalled();
    expect(teams.ensureAdminTeam).toHaveBeenCalled();
    expect(teams.ensureDefaultTeams).toHaveBeenCalled();
  });

  it('lê a marca e conta as equipes ANTES de criar a equipe Admin', async () => {
    const { service, order } = build({ hasTeams: true });

    await service.onModuleInit();

    expect(order.indexOf('read-mark')).toBeLessThan(order.indexOf('ensureAdminTeam'));
    expect(order.indexOf('count-teams')).toBeLessThan(order.indexOf('ensureAdminTeam'));
  });

  describe('marca nula e nenhuma equipe (migração inicial, CA-31)', () => {
    it('atribui por perfil como antes, loga cada atribuição com userId e organizationId e grava a marca no fim', async () => {
      const { service, membership, order } = build({ hasTeams: false, users: orphans });

      await service.onModuleInit();

      expect(membership.assign).toHaveBeenCalledTimes(3);
      expect(membership.assign.mock.calls.map((c: any[]) => c[0].id).sort()).toEqual(['admin-orfao', 'financeiro-orfao', 'fixo-orfao']);
      const assigned = events().filter((e) => e.event === 'access_migration.assigned');
      expect(assigned.map((e) => e.userId).sort()).toEqual(['admin-orfao', 'financeiro-orfao', 'fixo-orfao']);
      for (const e of assigned) expect(e.organizationId).toBe(ORG);
      expect(order[order.length - 1]).toBe('mark');
      expect(order.lastIndexOf('assign')).toBeLessThan(order.indexOf('mark'));
    });

    it('equipe Admin sem membros recebe os usuários ADMIN (bloco das l.86-91)', async () => {
      const { service, membership } = build({ hasTeams: false, users: [user('adm', 'ADMIN', 't-outra')] });

      await service.onModuleInit();

      expect(membership.assign).toHaveBeenCalledTimes(1);
      expect(membership.assign.mock.calls[0][1]).toBe('t-admin');
    });

    it('não grava o evento marked_without_assignment', async () => {
      const { service } = build({ hasTeams: false });

      await service.onModuleInit();

      expect(events().some((e) => e.event === 'access_migration.marked_without_assignment')).toBe(false);
    });
  });

  it('marca ilegível: não atribui, não marca, loga warn e mantém Admin e equipes padrão', async () => {
    const { service, membership, teams, dataSource } = build({ readFails: true, users: orphans });

    await service.onModuleInit();

    expect(membership.assign).not.toHaveBeenCalled();
    expect(markUpdates(dataSource)).toHaveLength(0);
    expect(logged.some((l) => l.level === 'warn' && l.message.includes('mark_unreadable'))).toBe(true);
    expect(teams.ensureAdminTeam).toHaveBeenCalled();
    expect(teams.ensureDefaultTeams).toHaveBeenCalled();
  });

  it('o acesso antigo das equipes anteriores às permissões continua sendo aplicado com a marca preenchida', async () => {
    const { service, teams } = build({ migratedAt: new Date(), hasTeams: true, oldTeams: [{ id: 't-velha' }], users: [user('u', 'VOLUNTEER', 't-velha')] });

    await service.onModuleInit();

    expect(teams.setPermissions).toHaveBeenCalledWith('t-velha', expect.any(Object));
  });
});
