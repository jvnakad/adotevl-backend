import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { TestAppModule, cleanupAccess, joinTeam } from './test-app.module';
import { Profile } from '../src/profile/profile.entity';
import { Organization } from '../src/organization/organization.entity';
import { User } from '../src/user/user.entity';
import { VolunteerShift } from '../src/volunteer-schedule/volunteer-shift.entity';
import { MailService } from '../src/mail/mail.service';
import { AccessLevel, Screen } from '../src/access/access';
import { addDays, isWeekend, todayInBrazil } from '../src/volunteer-schedule/schedule-time';

describe('Agenda de voluntariado (e2e)', () => {
  let app: INestApplication;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let shiftRepo: Repository<VolunteerShift>;
  let orgId: string;
  let adminToken: string;
  let volunteerToken: string;
  let volunteerId: string;

  // Dia útil (seg–sex 08h–16h): os horários abaixo não valem no fim de semana
  let day = addDays(todayInBrazil(), 5);
  while (isWeekend(day)) day = addDays(day, 1);
  const month = day.slice(0, 7);
  const server = () => app.getHttpServer();
  const login = async (email: string) => (await request(server()).post('/auth/login').send({ email, password: 'senha123' })).body.access_token;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    orgRepo = moduleFixture.get(getRepositoryToken(Organization));
    userRepo = moduleFixture.get(getRepositoryToken(User));
    shiftRepo = moduleFixture.get(getRepositoryToken(VolunteerShift));
    const profileRepo: Repository<Profile> = moduleFixture.get(getRepositoryToken(Profile));

    const existing = await orgRepo.findOne({ where: { cnpj: '66666666666666' } });
    if (existing) {
      await app.get(DataSource).query('DELETE FROM volunteer_shifts WHERE organization_id = $1', [existing.id]);
      await app.get(DataSource).query('DELETE FROM schedule_locks WHERE organization_id = $1', [existing.id]);
      await cleanupAccess(app, existing.id);
      await userRepo.delete({ organizationId: existing.id });
      await orgRepo.delete({ id: existing.id });
    }
    if (!(await profileRepo.findOne({ where: { name: 'VOLUNTEER' } }))) {
      await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
    }
    const profile = await profileRepo.findOne({ where: { name: 'VOLUNTEER' } });
    orgId = (await orgRepo.save({ legalName: 'Org Agenda', cnpj: '66666666666666' })).id;

    const password = await bcrypt.hash('senha123', 10);
    const base = { password, profileId: profile.id, organizationId: orgId, isConfirmed: true, isApproved: true, isActive: true };
    const admin = await userRepo.save({ ...base, fullName: 'Ana Agenda', cpf: '10000000001', email: 'ana.agenda@teste.com' });
    const volunteer = await userRepo.save({ ...base, fullName: 'Isa Kaori Agenda', cpf: '10000000002', email: 'isa.agenda@teste.com' });
    volunteerId = volunteer.id;
    await joinTeam(app, admin, 'ADMIN');
    await joinTeam(app, volunteer, { [Screen.SCHEDULE]: AccessLevel.VIEW });
    adminToken = await login('ana.agenda@teste.com');
    volunteerToken = await login('isa.agenda@teste.com');
  }, 30000);

  afterAll(async () => {
    const dataSource = app.get(DataSource);
    await dataSource.query('DELETE FROM volunteer_shifts WHERE organization_id = $1', [orgId]);
    await dataSource.query('DELETE FROM schedule_locks WHERE organization_id = $1', [orgId]);
    await cleanupAccess(app, orgId);
    await userRepo.delete({ organizationId: orgId });
    await orgRepo.delete({ id: orgId });
    await app.close();
  }, 30000);

  it('voluntário marca pelo sistema; LP mostra só "Voluntário" e a equipe Admin vê o nome', async () => {
    const booked = await request(server())
      .post('/schedule/shifts')
      .set('Authorization', `Bearer ${volunteerToken}`)
      .send({ date: day, startTime: '09:00', endTime: '12:00' });
    expect(booked.status).toBe(201);

    const lp = await request(server()).get(`/public/schedule?organizationId=${orgId}&month=${month}`);
    expect(lp.status).toBe(200);
    expect(lp.body.shifts).toEqual([expect.objectContaining({ date: day, startTime: '09:00', endTime: '12:00', name: 'Voluntário', id: null })]);
    expect(JSON.stringify(lp.body)).not.toContain('Isa');

    const asAdmin = await request(server()).get(`/schedule?month=${month}`).set('Authorization', `Bearer ${adminToken}`);
    expect(asAdmin.body.shifts[0].name).toBe('Isa Kaori Agenda');

    const asSelf = await request(server()).get(`/schedule?month=${month}`).set('Authorization', `Bearer ${volunteerToken}`);
    expect(asSelf.body.shifts[0]).toEqual(expect.objectContaining({ name: 'Você', mine: true }));
  });

  it('pela LP: código por e-mail abre a sessão, marca outro horário no dia e vê os próprios', async () => {
    const mail = app.get(MailService) as unknown as { lastScheduleCode: string };

    const unknown = await request(server()).post('/public/schedule/code').send({ email: 'ninguem.agenda@teste.com', organizationId: orgId });
    expect(unknown.body).toEqual(expect.objectContaining({ status: 'NOT_VOLUNTEER' }));

    const asked = await request(server()).post('/public/schedule/code').send({ email: 'ISA.agenda@teste.com', organizationId: orgId });
    expect(asked.status).toBe(201);
    expect(asked.body.status).toBe('SENT');
    expect(mail.lastScheduleCode).toMatch(/^\d{6}$/);

    const verified = await request(server()).post('/public/schedule/verify').send({ email: 'isa.agenda@teste.com', code: mail.lastScheduleCode, organizationId: orgId });
    expect(verified.status).toBe(201);
    expect(verified.body.firstName).toBe('Isa');
    const session = verified.body.token;

    const overlap = await request(server()).post('/public/schedule/shifts').set('Authorization', `Bearer ${session}`).send({ date: day, startTime: '11:00', endTime: '13:00' });
    expect(overlap.status).toBe(409);

    const booked = await request(server()).post('/public/schedule/shifts').set('Authorization', `Bearer ${session}`).send({ date: day, startTime: '14:00', endTime: '16:00' });
    expect(booked.status).toBe(201);

    // Cada marcação pede um código novo; a sessão segue valendo para ver e desmarcar
    const again = await request(server()).post('/public/schedule/shifts').set('Authorization', `Bearer ${session}`).send({ date: day, startTime: '12:00', endTime: '13:00' });
    expect(again.status).toBe(401);

    const mine = await request(server()).get(`/public/schedule?organizationId=${orgId}&month=${month}`).set('Authorization', `Bearer ${session}`);
    expect(mine.body.shifts.filter((shift) => shift.mine)).toHaveLength(2);

    // Sessão da agenda não vale como login do sistema
    const misuse = await request(server()).get(`/schedule?month=${month}`).set('Authorization', `Bearer ${session}`);
    expect(misuse.status).toBe(401);
  });

  it('desmarca pelo link do e-mail', async () => {
    const shift = await shiftRepo.findOne({ where: { userId: volunteerId, startTime: '14:00' } });

    const res = await request(server()).post('/public/schedule/cancel').send({ token: shift.cancelToken });
    expect(res.status).toBe(201);

    const again = await request(server()).post('/public/schedule/cancel').send({ token: shift.cancelToken });
    expect(again.status).toBe(404);
  });

  it('dia trancado: desmarca quem estava, mostra a mensagem e não aceita marcação', async () => {
    const locked = await request(server()).post('/schedule/locks').set('Authorization', `Bearer ${adminToken}`).send({ date: day, message: 'Mutirão de castração' });
    expect(locked.status).toBe(201);
    expect(locked.body.cancelledShifts).toBe(1);

    const lp = await request(server()).get(`/public/schedule?organizationId=${orgId}&month=${month}`);
    expect(lp.body.locks).toEqual([expect.objectContaining({ date: day, message: 'Mutirão de castração' })]);
    expect(lp.body.shifts).toEqual([]);

    const blocked = await request(server()).post('/schedule/shifts').set('Authorization', `Bearer ${volunteerToken}`).send({ date: day, startTime: '09:00', endTime: '10:00' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toBe('Dia trancado: Mutirão de castração');

    // Só Agenda (Editar) tranca
    const forbidden = await request(server()).post('/schedule/locks').set('Authorization', `Bearer ${volunteerToken}`).send({ date: addDays(day, 1), message: 'x' });
    expect(forbidden.status).toBe(403);
  });

  // Por último: esgota o limite de pedidos de código deste IP
  it('limita pedidos de código por IP (429)', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      statuses.push((await request(server()).post('/public/schedule/code').send({ email: 'x@teste.com', organizationId: orgId })).status);
    }
    expect(statuses).toContain(429);
  });
});
