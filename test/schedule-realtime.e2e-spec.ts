import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { io, Socket } from 'socket.io-client';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { TestAppModule, cleanupAccess, joinTeam } from './test-app.module';
import { Profile } from '../src/profile/profile.entity';
import { Organization } from '../src/organization/organization.entity';
import { User } from '../src/user/user.entity';
import { MailService } from '../src/mail/mail.service';
import { AccessLevel, Screen } from '../src/access/access';
import { TeamService } from '../src/team/team.service';
import { addDays, isWeekend, todayInBrazil } from '../src/volunteer-schedule/schedule-time';

describe('Agenda: tempo real no painel (e2e)', () => {
  let app: INestApplication;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let orgA: string;
  let orgB: string;
  let url: string;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const teamIds: Record<string, string> = {};
  const sockets: Socket[] = [];

  const nextBusinessDay = (from: string) => {
    let day = addDays(from, 1);
    while (isWeekend(day)) day = addDays(day, 1);
    return day;
  };
  const day1 = nextBusinessDay(addDays(todayInBrazil(), 4));
  const day2 = nextBusinessDay(day1);
  const day3 = nextBusinessDay(day2);
  const day4 = nextBusinessDay(day3);

  const server = () => app.getHttpServer();
  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who: string, body?: object, clientId?: string) => {
    let req = request(server())[method](path).set('Authorization', `Bearer ${tokens[who]}`);
    if (clientId) req = req.set('X-Client-Id', clientId);
    return body ? req.send(body) : req;
  };
  const login = async (email: string) => (await request(server()).post('/auth/login').send({ email, password: 'senha123' })).body.access_token;

  const CNPJ_A = '97979797979791';
  const CNPJ_B = '97979797979792';

  async function cleanOrg(cnpj: string) {
    const existing = await orgRepo.findOne({ where: { cnpj } });
    if (!existing) return;
    await app.get(DataSource).query('DELETE FROM schedule_locks WHERE organization_id = $1', [existing.id]);
    await cleanupAccess(app, existing.id);
    await userRepo.delete({ organizationId: existing.id });
    await orgRepo.delete({ id: existing.id });
  }

  async function createUser(organizationId: string, key: string, cpf: string, access: 'ADMIN' | Partial<Record<Screen, AccessLevel>>) {
    const profile = await app.get<Repository<Profile>>(getRepositoryToken(Profile)).findOne({ where: { name: 'VOLUNTEER' } });
    const user = await userRepo.save({
      fullName: `Pessoa ${key}`,
      cpf,
      email: `${key}.agrt@teste.com`,
      password: await bcrypt.hash('senha123', 10),
      profileId: profile.id,
      organizationId,
      isConfirmed: true,
      isApproved: true,
      isActive: true,
    });
    teamIds[key] = (await joinTeam(app, user, access)).id;
    ids[key] = user.id;
    tokens[key] = await login(`${key}.agrt@teste.com`);
  }

  const connectAs = (who: string) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = io(url, { auth: { token: tokens[who] }, transports: ['websocket'], reconnection: false, forceNew: true });
      sockets.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', (error) => reject(new Error(`conexão de ${who} recusada: ${error.message}`)));
    });
  const join = (socket: Socket, room: string) => socket.timeout(3000).emitWithAck('room:join', { room }) as Promise<{ ok: boolean; error?: string }>;
  const nextEvent = <T = any>(socket: Socket, event: string, timeout = 3000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`sem ${event} em ${timeout}ms`)), timeout);
      socket.once(event, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  const collect = (socket: Socket, event: string) => {
    const received: any[] = [];
    socket.on(event, (payload) => received.push(payload));
    return received;
  };
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const room = (orgId: string) => `schedule:${orgId}`;
  const watcher = async (who = 'viewer', orgId = orgA) => {
    const socket = await connectAs(who);
    expect((await join(socket, room(orgId))).ok).toBe(true);
    return socket;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as { port: number }).port}`;

    orgRepo = moduleFixture.get(getRepositoryToken(Organization));
    userRepo = moduleFixture.get(getRepositoryToken(User));
    const profileRepo: Repository<Profile> = moduleFixture.get(getRepositoryToken(Profile));
    await cleanOrg(CNPJ_A);
    await cleanOrg(CNPJ_B);
    if (!(await profileRepo.findOne({ where: { name: 'VOLUNTEER' } }))) {
      await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
    }
    orgA = (await orgRepo.save({ legalName: 'Org Agenda RT A', cnpj: CNPJ_A })).id;
    orgB = (await orgRepo.save({ legalName: 'Org Agenda RT B', cnpj: CNPJ_B })).id;

    await createUser(orgA, 'admina', '74000000001', 'ADMIN');
    await createUser(orgA, 'viewer', '74000000002', { [Screen.SCHEDULE]: AccessLevel.VIEW });
    await createUser(orgA, 'other', '74000000003', { [Screen.PETS]: AccessLevel.EDIT });
    await createUser(orgB, 'adminb', '74000000004', 'ADMIN');
  }, 60000);

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    for (const orgId of [orgA, orgB]) {
      await app.get(DataSource).query('DELETE FROM schedule_locks WHERE organization_id = $1', [orgId]);
      await cleanupAccess(app, orgId);
      await userRepo.delete({ organizationId: orgId });
      await orgRepo.delete({ id: orgId });
    }
    await app.close();
  }, 60000);

  it('sala da agenda: Visualizar e Admin entram; sem Agenda, outra organização e sala inválida são negados', async () => {
    expect((await join(await connectAs('viewer'), room(orgA))).ok).toBe(true);
    expect((await join(await connectAs('admina'), room(orgA))).ok).toBe(true);
    expect(await join(await connectAs('other'), room(orgA))).toMatchObject({ ok: false, error: 'FORBIDDEN' });
    expect((await join(await connectAs('adminb'), room(orgA))).ok).toBe(false);
    expect((await join(await connectAs('viewer'), room(orgB))).ok).toBe(false);
    expect((await join(await connectAs('viewer'), 'schedule:')).ok).toBe(false);
  });

  it('reserva pelo painel: quem está na sala recebe só organização, dia, tipo, autor e clientId; nada vaza para outra organização ou para quem não entrou', async () => {
    const viewer = await watcher();
    const adminB = await connectAs('adminb');
    await join(adminB, room(orgB));
    const outsider = await connectAs('other');
    await join(outsider, room(orgA));
    const leakedToB = collect(adminB, 'schedule.changed');
    const leakedToOther = collect(outsider, 'schedule.changed');

    const received = nextEvent(viewer, 'schedule.changed');
    const booked = await call('post', '/schedule/shifts', 'viewer', { date: day1, startTime: '09:00', endTime: '12:00', notes: 'Observação secreta' }, 'aba-1');
    const event = await received;

    expect(booked.status).toBe(201);
    expect(event).toEqual({ organizationId: orgA, dates: [day1], kind: 'shift.created', actor: { id: ids.viewer }, clientId: 'aba-1' });
    expect(JSON.stringify(event)).not.toMatch(/Pessoa|secreta/);
    await pause(400);
    expect(leakedToB).toEqual([]);
    expect(leakedToOther).toEqual([]);
    ids.shift = booked.body.id;
  });

  it('editar e desmarcar pelo painel emitem shift.updated e shift.cancelled', async () => {
    const viewer = await watcher();

    let next = nextEvent(viewer, 'schedule.changed');
    await call('patch', `/schedule/shifts/${ids.shift}`, 'admina', { startTime: '10:00', endTime: '12:00' });
    expect(await next).toMatchObject({ kind: 'shift.updated', dates: [day1], actor: { id: ids.admina } });

    next = nextEvent(viewer, 'schedule.changed');
    await call('delete', `/schedule/shifts/${ids.shift}`, 'admina');
    expect(await next).toMatchObject({ kind: 'shift.cancelled', dates: [day1] });
  });

  it('reserva e cancelamento pela LP (sessão e link do e-mail): sem autor e sem clientId', async () => {
    const viewer = await watcher();
    const mail = app.get(MailService) as unknown as { lastScheduleCode: string };
    await request(server()).post('/public/schedule/code').send({ email: 'viewer.agrt@teste.com', organizationId: orgA });
    const verified = await request(server()).post('/public/schedule/verify').send({ email: 'viewer.agrt@teste.com', code: mail.lastScheduleCode, organizationId: orgA });
    const session = verified.body.token;

    let next = nextEvent(viewer, 'schedule.changed');
    const booked = await request(server()).post('/public/schedule/shifts').set('Authorization', `Bearer ${session}`).set('X-Client-Id', 'aba-lp').send({ date: day2, startTime: '09:00', endTime: '11:00' });
    expect(booked.status).toBe(201);
    expect(await next).toEqual({ organizationId: orgA, dates: [day2], kind: 'shift.created' });

    next = nextEvent(viewer, 'schedule.changed');
    await request(server()).delete(`/public/schedule/shifts/${booked.body.id}`).set('Authorization', `Bearer ${session}`);
    expect(await next).toEqual({ organizationId: orgA, dates: [day2], kind: 'shift.cancelled' });

    await call('post', '/schedule/shifts', 'viewer', { date: day2, startTime: '13:00', endTime: '14:00' });
    const [{ cancel_token: token }] = await app.get(DataSource).query('SELECT cancel_token FROM volunteer_shifts WHERE organization_id = $1 AND date = $2 AND cancelled_at IS NULL', [orgA, day2]);
    next = nextEvent(viewer, 'schedule.changed');
    const cancelled = await request(server()).post('/public/schedule/cancel').send({ token });
    expect(cancelled.status).toBe(201);
    expect(await next).toEqual({ organizationId: orgA, dates: [day2], kind: 'shift.cancelled' });
  });

  it('bloquear dia com reserva emite shift.cancelled e lock.created; desbloquear emite lock.removed', async () => {
    const viewer = await watcher();
    await call('post', '/schedule/shifts', 'viewer', { date: day3, startTime: '09:00', endTime: '10:00' });
    await pause(200);
    const events = collect(viewer, 'schedule.changed');

    const lock = await call('post', '/schedule/locks', 'admina', { date: day3, message: 'Mutirão' }, 'aba-2');
    expect(lock.status).toBe(201);
    await pause(500);
    expect(events.map((event) => event.kind)).toEqual(['shift.cancelled', 'lock.created']);
    expect(events[1]).toEqual({ organizationId: orgA, dates: [day3], kind: 'lock.created', actor: { id: ids.admina }, clientId: 'aba-2' });
    expect(JSON.stringify(events)).not.toContain('Mutirão');

    const next = nextEvent(viewer, 'schedule.changed');
    await call('delete', `/schedule/locks/${lock.body.id}`, 'admina');
    expect(await next).toMatchObject({ kind: 'lock.removed', dates: [day3] });
  });

  it('faculdades: criar, renomear/desativar e excluir emitem institutions.changed sem dias', async () => {
    const viewer = await watcher();

    let next = nextEvent(viewer, 'schedule.changed');
    const created = await call('post', '/schedule/institutions', 'admina', { name: 'Faculdade Tempo Real' });
    expect(created.status).toBe(201);
    expect(await next).toEqual({ organizationId: orgA, dates: [], kind: 'institutions.changed', actor: { id: ids.admina } });

    next = nextEvent(viewer, 'schedule.changed');
    await call('patch', `/schedule/institutions/${created.body.id}`, 'admina', { isActive: false });
    expect((await next).kind).toBe('institutions.changed');

    next = nextEvent(viewer, 'schedule.changed');
    await call('delete', `/schedule/institutions/${created.body.id}`, 'admina');
    expect((await next).kind).toBe('institutions.changed');
  });

  it('ação recusada não emite', async () => {
    const viewer = await watcher();
    const events = collect(viewer, 'schedule.changed');

    expect((await call('post', '/schedule/shifts', 'viewer', { date: day4, startTime: '07:00', endTime: '09:00' })).status).toBe(400);
    expect((await call('post', '/schedule/locks', 'viewer', { date: day4, message: 'x' })).status).toBe(403);
    await pause(400);

    expect(events).toEqual([]);
  });

  it('acesso à Agenda revogado: na próxima emissão sai da sala (room:revoked), não recebe o evento e o rejoin é negado', async () => {
    const viewer = await watcher();
    const events = collect(viewer, 'schedule.changed');

    await app.get(TeamService).setPermissions(teamIds.viewer, {});
    const revoked = nextEvent(viewer, 'room:revoked');
    await call('post', '/schedule/locks', 'admina', { date: day4, message: 'Depois da revogação' });

    expect(await revoked).toEqual({ room: room(orgA) });
    await pause(300);
    expect(events).toEqual([]);
    expect((await join(viewer, room(orgA))).ok).toBe(false);
    await app.get(TeamService).setPermissions(teamIds.viewer, { [Screen.SCHEDULE]: AccessLevel.VIEW });
    expect((await join(viewer, room(orgA))).ok).toBe(true);
  });
});
