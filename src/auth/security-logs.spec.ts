import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { hashRefresh } from './refresh-token.service';
import { AccessMigrationService } from '../team/access-migration.service';
import { build, FAMILY, NOW, rowFor, Script, state, USER_AGENT, USER_ID } from '../testing/refresh-token-fakes';

jest.mock('bcryptjs', () => ({ compare: jest.fn(async () => true) }));

// Suíte de logs sem segredo (RN-17, SEC-14, INV-9): agulhas = refresh, hash, access e User-Agent
const RAW = 'R'.repeat(43);
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const IP = '203.0.113.7';

type Entry = { level: 'log' | 'warn' | 'error'; message: string };
let entries: Entry[];

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'] });
  entries = [];
  for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation((message: any) => void entries.push({ level, message: String(message) }));
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const events = () => entries.filter((e) => e.message.startsWith('{')).map((e) => ({ level: e.level, ...JSON.parse(e.message) }));
const eventOf = (name: string) => events().find((e) => e.event === name);

describe('eventos de segurança da sessão (RN-17)', () => {
  it('login: auth.refresh_issued com userId e familyId, nível log, sem IP', async () => {
    const { service } = build();
    const userService = {
      findByEmail: jest.fn(async () => ({ id: USER_ID, fullName: 'Ana', email: 'ana@teste.com', password: 'h', profileId: 'p1', profile: { name: 'VOLUNTEER' }, organizationId: 'org-1', isActive: true, isConfirmed: true, isApproved: true })),
    };
    const auth = new AuthService(userService as any, { isFloatingVolunteer: async () => false } as any, service);

    const result = await auth.login({ email: 'ana@teste.com', password: 'senha' }, USER_AGENT);

    expect(eventOf('auth.refresh_issued')).toEqual({ level: 'log', event: 'auth.refresh_issued', userId: USER_ID, familyId: expect.any(String) });
    expect(bcrypt.compare).toHaveBeenCalled();
    expect(result.refresh_token).toBeTruthy();
  });

  it('renovação: auth.refresh_rotated com userId e familyId, nível log, sem IP', async () => {
    const { service } = build({ consume: [rowFor()], subject: [state] });

    await service.rotate(RAW, { ip: IP });

    expect(eventOf('auth.refresh_rotated')).toEqual({ level: 'log', event: 'auth.refresh_rotated', userId: USER_ID, familyId: FAMILY });
  });

  it('reuso: auth.refresh_reuse com userId, familyId e IP, nível warn', async () => {
    const { service } = build({ classify: [{ userId: USER_ID, familyId: FAMILY, usedAt: new Date(), revokedAt: null }] });

    await service.rotate(RAW, { ip: IP }).catch(() => undefined);

    expect(eventOf('auth.refresh_reuse')).toEqual({ level: 'warn', event: 'auth.refresh_reuse', userId: USER_ID, familyId: FAMILY, ip: IP });
  });

  it.each([
    ['inexistente', { classify: [] }, undefined],
    ['expirado', { classify: [{ userId: USER_ID, familyId: FAMILY, usedAt: null, revokedAt: null }] }, 'expirado'],
    ['revogado', { classify: [{ userId: USER_ID, familyId: FAMILY, usedAt: null, revokedAt: new Date() }] }, 'revogado'],
    ['inativo', { consume: [rowFor()], subject: [{ ...state, isActive: false }] }, 'inativo'],
    ['teto', { consume: [rowFor({ familyStartedAt: new Date(NOW - 31 * 86_400_000) })], subject: [state] }, 'teto'],
  ])('recusa (%s): auth.refresh_rejected com motivo e IP, nível warn', async (motivo, rawScript, expectedMotivo) => {
    const script = rawScript as Script;
    const { service } = build(script);

    await service.rotate(RAW, { ip: IP }).catch(() => undefined);

    const event = eventOf('auth.refresh_rejected');
    expect(event).toEqual(expect.objectContaining({ level: 'warn', ip: IP, motivo: expectedMotivo ?? motivo }));
    if (script.classify?.length || script.consume) expect(event).toEqual(expect.objectContaining({ userId: USER_ID, familyId: FAMILY }));
  });

  it('expulsão pelo limite: auth.refresh_family_evicted com userId e familyId, nível warn, sem IP', async () => {
    const { service } = build({ evicted: [OTHER] });

    await service.issue({ id: USER_ID, email: 'a@b.c', profileId: 'p1', organizationId: 'org-1' }, USER_AGENT);

    expect(eventOf('auth.refresh_family_evicted')).toEqual({ level: 'warn', event: 'auth.refresh_family_evicted', userId: USER_ID, familyId: OTHER });
  });

  it('logout: auth.logout com userId e familyId, nível log, sem IP', async () => {
    const { service } = build();

    await service.revokeFamily(RAW);

    expect(eventOf('auth.logout')).toEqual({ level: 'log', event: 'auth.logout', userId: USER_ID, familyId: FAMILY });
  });

  it('migração: marked_without_assignment só com organizationId', async () => {
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT id FROM organizations')) return [{ id: 'org-1' }];
        if (sql.includes('access_migrated_at AS')) return [{ migratedAt: null }];
        if (sql.includes('SELECT EXISTS')) return [{ hasTeams: true }];
        if (sql.includes('UPDATE organizations')) return [[], 1];
        return [];
      }),
    };
    const teams = { ensureAdminTeam: async () => ({ id: 't' }), ensureDefaultTeams: async () => undefined };
    const migration = new AccessMigrationService(dataSource as any, teams as any, { assign: jest.fn() } as any);

    await migration.onModuleInit();

    expect(eventOf('access_migration.marked_without_assignment')).toEqual({ level: 'log', event: 'access_migration.marked_without_assignment', organizationId: 'org-1' });
  });

  it('o IP aparece só em refresh_reuse e refresh_rejected', async () => {
    for (const script of [
      { consume: [rowFor()], subject: [state] },
      { classify: [{ userId: USER_ID, familyId: FAMILY, usedAt: new Date(), revokedAt: null }] },
      { classify: [] },
      { evicted: [OTHER] },
    ] as any[]) {
      const { service } = build(script);
      if (script.evicted) await service.issue({ id: USER_ID, email: 'a@b.c', profileId: 'p1', organizationId: 'org-1' });
      else await service.rotate(RAW, { ip: IP }).catch(() => undefined);
    }
    await build().service.revokeFamily(RAW);

    for (const event of events()) {
      if (['auth.refresh_reuse', 'auth.refresh_rejected'].includes(event.event)) expect(event.ip).toBe(IP);
      else expect(event).not.toHaveProperty('ip');
    }
  });
});

describe('nenhuma agulha em log, exceção ou resposta (SEC-14)', () => {
  it('percorre login, renovação, reuso, recusa, expulsão, logout e migração', async () => {
    const needles: string[] = [RAW, USER_AGENT, 'AgenteSecreto', hashRefresh(RAW)];
    const thrown: string[] = [];
    const capture = async (promise: Promise<any>) => {
      const result = await promise.then(
        (value) => value,
        (error) => {
          thrown.push(JSON.stringify(error.getResponse?.() ?? error.message));
          return null;
        },
      );
      if (result?.refresh_token) needles.push(result.refresh_token, hashRefresh(result.refresh_token), result.access_token);
      return result;
    };

    const ok = build({ consume: [rowFor()], subject: [state] });
    await capture(ok.service.rotate(RAW, { userAgent: USER_AGENT, ip: IP }));
    await capture(build({ classify: [{ userId: USER_ID, familyId: FAMILY, usedAt: new Date(), revokedAt: null }] }).service.rotate(RAW, { userAgent: USER_AGENT, ip: IP }));
    await capture(build({ classify: [] }).service.rotate(RAW, { userAgent: USER_AGENT, ip: IP }));
    await capture(build({ consume: [rowFor({ familyStartedAt: new Date(NOW - 40 * 86_400_000) })], subject: [state] }).service.rotate(RAW, { userAgent: USER_AGENT, ip: IP }));
    await capture(build({ evicted: [OTHER], failCleanup: true }).service.issue({ id: USER_ID, email: 'a@b.c', profileId: 'p1', organizationId: 'org-1' }, USER_AGENT));
    await capture(build().service.revokeFamily(RAW));
    await capture(build({ failInsert: true, consume: [rowFor()], subject: [state] }).service.rotate(RAW, { userAgent: USER_AGENT, ip: IP }));

    const everything = [...entries.map((e) => e.message), ...thrown].join('\n');
    expect(entries.length).toBeGreaterThan(5);
    for (const needle of needles) expect(everything).not.toContain(needle);
  });
});
