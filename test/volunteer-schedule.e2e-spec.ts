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
  let otherOrgId: string;

  // Dia útil (seg–sex 08h–16h): os horários abaixo não valem no fim de semana
  let day = addDays(todayInBrazil(), 5);
  while (isWeekend(day)) day = addDays(day, 1);
  // Dias das faculdades: depois do dia trancado, também úteis
  let programDay = addDays(day, 1);
  while (isWeekend(programDay)) programDay = addDays(programDay, 1);
  const programMonth = programDay.slice(0, 7);
  const month = day.slice(0, 7);
  const server = () => app.getHttpServer();
  const login = async (email: string) => (await request(server()).post('/auth/login').send({ email, password: 'senha123' })).body.access_token;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    // Servidor escutando de verdade: sem isso o supertest abre uma porta por requisicao e, com muitas em paralelo, o CI derruba conexoes (ECONNRESET)
    await app.listen(0);

    orgRepo = moduleFixture.get(getRepositoryToken(Organization));
    userRepo = moduleFixture.get(getRepositoryToken(User));
    shiftRepo = moduleFixture.get(getRepositoryToken(VolunteerShift));
    const profileRepo: Repository<Profile> = moduleFixture.get(getRepositoryToken(Profile));

    const existing = await orgRepo.findOne({ where: { cnpj: '66666666666666' } });
    // Ordem: turnos, faculdades (RESTRICT dos turnos), usuários (SET NULL), organização
    for (const cnpj of ['66666666666666', '66666666666667']) {
      const old = await orgRepo.findOne({ where: { cnpj } });
      if (!old) continue;
      await app.get(DataSource).query('DELETE FROM schedule_locks WHERE organization_id = $1', [old.id]);
      await cleanupAccess(app, old.id);
      await userRepo.delete({ organizationId: old.id });
      await orgRepo.delete({ id: old.id });
    }
    if (!(await profileRepo.findOne({ where: { name: 'VOLUNTEER' } }))) {
      await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
    }
    const profile = await profileRepo.findOne({ where: { name: 'VOLUNTEER' } });
    orgId = (await orgRepo.save({ legalName: 'Org Agenda', cnpj: '66666666666666' })).id;
    otherOrgId = (await orgRepo.save({ legalName: 'Outra Org Agenda', cnpj: '66666666666667' })).id;

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
    await dataSource.query('DELETE FROM schedule_locks WHERE organization_id = $1', [orgId]);
    for (const id of [orgId, otherOrgId]) {
      await cleanupAccess(app, id);
      await userRepo.delete({ organizationId: id });
      await orgRepo.delete({ id });
    }
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


  describe('faculdades do programa de horas complementares', () => {
    const asAdmin = () => ({ Authorization: `Bearer ${adminToken}` });
    const asVolunteer = () => ({ Authorization: `Bearer ${volunteerToken}` });
    const program = { startTime: '09:00', endTime: '10:00' };
    let pucprId: string;
    let ufprId: string;
    let otherOrgInstitutionId: string;

    const listAdmin = async () => (await request(server()).get('/schedule/institutions').set(asAdmin())).body as { id: string; name: string; isActive: boolean; totalShifts: number; upcomingShifts: number }[];
    const bookAsVolunteer = (body: object) => request(server()).post('/schedule/shifts').set(asVolunteer()).send({ date: programDay, ...body });

    beforeAll(async () => {
      otherOrgInstitutionId = (await app.get(DataSource).query(`INSERT INTO schedule_institutions (organization_id, name, name_normalized) VALUES ($1, 'Outra Faculdade', 'outra faculdade') RETURNING id`, [otherOrgId]))[0].id;
    });

    it('organização nova nasce com a PUCPR ativa (CA-01)', async () => {
      const list = await listAdmin();

      expect(list).toEqual([{ id: expect.any(String), name: 'PUCPR', isActive: true, totalShifts: 0, upcomingShifts: 0 }]);
      pucprId = list[0].id;
    });

    it('Admin cria, não repete nome (mesmo com outra caixa) e rejeita nome vazio ou grande (CA-02)', async () => {
      const created = await request(server()).post('/schedule/institutions').set(asAdmin()).send({ name: '  UFPR ' });
      expect(created.status).toBe(201);
      expect(created.body).toEqual({ id: expect.any(String), name: 'UFPR', isActive: true, totalShifts: 0, upcomingShifts: 0 });
      ufprId = created.body.id;

      const duplicated = await request(server()).post('/schedule/institutions').set(asAdmin()).send({ name: 'ufpr' });
      expect(duplicated.status).toBe(409);
      expect(duplicated.body.message).toBe('Já existe uma faculdade com esse nome.');

      expect((await request(server()).post('/schedule/institutions').set(asAdmin()).send({ name: '   ' })).status).toBe(400);
      expect((await request(server()).post('/schedule/institutions').set(asAdmin()).send({ name: 'x'.repeat(81) })).status).toBe(400);
      expect((await request(server()).patch(`/schedule/institutions/${ufprId}`).set(asAdmin()).send({})).status).toBe(400);
    });

    it('quem não é da equipe Admin recebe 403 nas quatro rotas, sem tocar nos dados (CA-03)', async () => {
      const calls = [
        () => request(server()).get('/schedule/institutions').set(asVolunteer()),
        () => request(server()).post('/schedule/institutions').set(asVolunteer()).send({ name: 'Intrusa' }),
        () => request(server()).patch(`/schedule/institutions/${ufprId}`).set(asVolunteer()).send({ isActive: false }),
        () => request(server()).delete(`/schedule/institutions/${ufprId}`).set(asVolunteer()),
      ];
      for (const call of calls) expect((await call()).status).toBe(403);
      expect((await listAdmin()).map((item) => item.name)).toEqual(['PUCPR', 'UFPR']);
      expect((await request(server()).get('/schedule/institutions')).status).toBe(401);
    });

    it('LP lista só as ativas, em ordem; organizationId inválido é 400', async () => {
      const list = await request(server()).get(`/public/schedule/institutions?organizationId=${orgId}`);
      expect(list.status).toBe(200);
      expect(list.body).toEqual([{ id: pucprId, name: 'PUCPR' }, { id: ufprId, name: 'UFPR' }]);

      expect((await request(server()).get('/public/schedule/institutions?organizationId=nao-e-uuid')).status).toBe(400);

      // Painel: quem tem Agenda (Visualizar) lista as ativas sem ser Admin; sem token é 401
      const panel = await request(server()).get('/schedule/institutions/active').set(asVolunteer());
      expect(panel.status).toBe(200);
      expect(panel.body).toEqual([{ id: pucprId, name: 'PUCPR' }, { id: ufprId, name: 'UFPR' }]);
      expect((await request(server()).get('/schedule/institutions/active')).status).toBe(401);
    });

    it('agendar: faculdade sem curso, curso sem faculdade, curso curto ou só espaços é 400 (CA-17)', async () => {
      for (const body of [{ institutionId: pucprId }, { course: 'Direito' }, { institutionId: pucprId, course: 'D' }, { institutionId: pucprId, course: '   ' }, { institutionId: 'abc', course: 'Direito' }, { institutionId: pucprId, course: 'x'.repeat(121) }]) {
        const res = await bookAsVolunteer({ ...program, ...body });
        expect(res.status).toBe(400);
      }
      // Curso só com espaços conta como ausente: vale a mensagem do par (BUG-05)
      const blank = await bookAsVolunteer({ ...program, institutionId: pucprId, course: '    ' });
      expect(blank.body.message).toBe('Informe a faculdade e o curso juntos, ou nenhum dos dois.');
      const short = await bookAsVolunteer({ ...program, institutionId: pucprId, course: 'D' });
      expect(short.body.message).toEqual(['O curso precisa ter entre 2 e 120 caracteres.']);
      expect(await shiftRepo.count({ where: { userId: volunteerId, date: programDay } })).toBe(0);
    });

    it('agendar: faculdade de outra organização ou inexistente é 400 (CA-18)', async () => {
      const other = await bookAsVolunteer({ ...program, institutionId: otherOrgInstitutionId, course: 'Direito' });
      expect(other.status).toBe(400);
      expect(other.body.message).toBe('Essa faculdade não está mais disponível, escolha outra.');

      const missing = await bookAsVolunteer({ ...program, institutionId: '2f8f4c43-6f45-4a9e-9c3b-0f2f3b1b6a11', course: 'Direito' });
      expect(missing.status).toBe(400);
    });

    it('agendar: faculdade desativada é 400 e some da lista da LP; ativar volta (CA-06)', async () => {
      const off = await request(server()).patch(`/schedule/institutions/${ufprId}`).set(asAdmin()).send({ isActive: false });
      expect(off.status).toBe(200);
      expect(off.body).toEqual({ id: ufprId, name: 'UFPR', isActive: false, totalShifts: 0, upcomingShifts: 0 });

      const res = await bookAsVolunteer({ ...program, institutionId: ufprId, course: 'Direito' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Essa faculdade não está mais disponível, escolha outra.');

      const lp = await request(server()).get(`/public/schedule/institutions?organizationId=${orgId}`);
      expect(lp.body).toEqual([{ id: pucprId, name: 'PUCPR' }]);

      expect((await request(server()).patch(`/schedule/institutions/${ufprId}`).set(asAdmin()).send({ isActive: true })).status).toBe(200);
    });

    it('meu programa: null enquanto o usuário nunca agendou pelo programa', async () => {
      const res = await request(server()).get('/schedule/me/program').set(asAdmin());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it('Admin agenda em nome do voluntário: grava faculdade e curso e o prefill do voluntário muda (CA-23)', async () => {
      const mail = app.get(MailService) as unknown as { lastShiftConfirmation: { institutionName: string; course: string } };
      const res = await request(server()).post('/schedule/shifts').set(asAdmin()).send({ date: programDay, ...program, userId: volunteerId, institutionId: ufprId, course: '  Medicina ' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual(expect.objectContaining({ userId: volunteerId, institutionId: ufprId, institutionName: 'UFPR', course: 'Medicina' }));
      expect(mail.lastShiftConfirmation).toEqual(expect.objectContaining({ institutionName: 'UFPR', course: 'Medicina' }));

      const volunteers = await request(server()).get('/schedule/volunteers').set(asAdmin());
      expect(volunteers.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: volunteerId, institutionId: ufprId, course: 'Medicina' })]));
    });

    it('painel: Admin vê faculdade e curso de todos; o voluntário só nos próprios; a LP nunca (CA-22)', async () => {
      // Turno da Ana (Admin) sem programa para separar o que é de quem
      await request(server()).post('/schedule/shifts').set(asAdmin()).send({ date: programDay, startTime: '14:00', endTime: '15:00' });

      const admin = await request(server()).get(`/schedule?month=${programMonth}`).set(asAdmin());
      expect(admin.body.shifts.find((shift) => shift.startTime === '09:00')).toEqual(expect.objectContaining({ name: 'Isa Kaori Agenda', institutionName: 'UFPR', course: 'Medicina' }));
      expect(admin.body.shifts.find((shift) => shift.startTime === '14:00')).toEqual(expect.objectContaining({ institutionName: null, course: null }));

      const adminAsOther = await request(server()).get(`/schedule?month=${programMonth}`).set(asVolunteer());
      const own = adminAsOther.body.shifts.find((shift) => shift.startTime === '09:00');
      expect(own).toEqual(expect.objectContaining({ name: 'Você', institutionName: 'UFPR', course: 'Medicina' }));
      expect(adminAsOther.body.shifts.find((shift) => shift.startTime === '14:00')).toEqual(expect.objectContaining({ name: 'Voluntário', institutionName: null, course: null }));

      const lp = await request(server()).get(`/public/schedule?organizationId=${orgId}&month=${programMonth}`);
      expect(JSON.stringify(lp.body)).not.toMatch(/UFPR|Medicina/);
    });

    it('LP: sem faculdade o prefill é null; com "Sim" grava, guarda no usuário e o prefill chega no próximo código (CA-13, CA-14, CA-19, CA-20)', async () => {
      const mail = app.get(MailService) as unknown as { lastScheduleCode: string; lastShiftConfirmation: { institutionName: string; course: string } };
      const login = async () => {
        await request(server()).post('/public/schedule/code').send({ email: 'isa.agenda@teste.com', organizationId: orgId });
        return request(server()).post('/public/schedule/verify').send({ email: 'isa.agenda@teste.com', code: mail.lastScheduleCode, organizationId: orgId });
      };

      // Prefill vindo do agendamento feito pelo Admin (UFPR / Medicina)
      const first = await login();
      expect(first.status).toBe(201);
      expect(first.body.program).toEqual({ institutionId: ufprId, institutionName: 'UFPR', course: 'Medicina' });

      // A rota de marcar tem limite de 5 por minuto por IP: as validações de 400 ficam na rota do sistema, acima
      const session = { Authorization: `Bearer ${first.body.token}` };
      const booked = await request(server()).post('/public/schedule/shifts').set(session).send({ date: programDay, startTime: '11:00', endTime: '12:00', institutionId: pucprId, course: 'Direito' });
      expect(booked.status).toBe(201);
      expect(mail.lastShiftConfirmation).toEqual(expect.objectContaining({ institutionName: 'PUCPR', course: 'Direito' }));

      const mine = await request(server()).get(`/public/schedule?organizationId=${orgId}&month=${programMonth}`).set(session);
      expect(mine.body.shifts.find((shift) => shift.startTime === '11:00')).toEqual(expect.objectContaining({ mine: true, institutionName: 'PUCPR', course: 'Direito' }));

      // Segundo agendamento: o prefill agora é PUCPR / Direito; "Não" (sem os campos) não apaga o que estava guardado
      const second = await login();
      expect(second.body.program).toEqual({ institutionId: pucprId, institutionName: 'PUCPR', course: 'Direito' });
      const plain = await request(server()).post('/public/schedule/shifts').set({ Authorization: `Bearer ${second.body.token}` }).send({ date: programDay, startTime: '12:00', endTime: '13:00' });
      expect(plain.status).toBe(201);
      expect(plain.body).toEqual(expect.objectContaining({ institutionId: null, institutionName: null, course: null }));
      expect(mail.lastShiftConfirmation).toEqual(expect.objectContaining({ institutionName: null, course: null }));
      expect(await userRepo.findOne({ where: { id: volunteerId } })).toEqual(expect.objectContaining({ institutionId: pucprId, course: 'Direito' }));
    });

    it('renomear não altera turnos antigos; desativar avisa dos turnos futuros e o prefill traz só o curso (CA-05, D-10)', async () => {
      const renamed = await request(server()).patch(`/schedule/institutions/${pucprId}`).set(asAdmin()).send({ name: 'PUC-PR' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe('PUC-PR');

      const month = await request(server()).get(`/schedule?month=${programMonth}`).set(asAdmin());
      expect(month.body.shifts.find((shift) => shift.startTime === '11:00').institutionName).toBe('PUCPR');

      const off = await request(server()).patch(`/schedule/institutions/${pucprId}`).set(asAdmin()).send({ isActive: false });
      expect(off.body).toEqual(expect.objectContaining({ isActive: false, totalShifts: 1, upcomingShifts: 1 }));

      const mail = app.get(MailService) as unknown as { lastScheduleCode: string };
      await request(server()).post('/public/schedule/code').send({ email: 'isa.agenda@teste.com', organizationId: orgId });
      const verified = await request(server()).post('/public/schedule/verify').send({ email: 'isa.agenda@teste.com', code: mail.lastScheduleCode, organizationId: orgId });
      expect(verified.body.program).toEqual({ institutionId: null, institutionName: null, course: 'Direito' });

      const volunteers = await request(server()).get('/schedule/volunteers').set(asAdmin());
      expect(volunteers.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: volunteerId, institutionId: null, course: 'Direito' })]));

      const mine = await request(server()).get('/schedule/me/program').set(asVolunteer());
      expect(mine.status).toBe(200);
      expect(mine.body).toEqual({ institutionId: null, institutionName: null, course: 'Direito' });
      expect((await request(server()).get('/schedule/me/program')).status).toBe(401);
    });

    it('excluir faculdade já usada é 409 com aviso para desativar; a nunca usada sai (CA-04)', async () => {
      const used = await request(server()).delete(`/schedule/institutions/${pucprId}`).set(asAdmin());
      expect(used.status).toBe(409);
      expect(used.body.message).toBe('Essa faculdade já foi usada em agendamentos. Desative-a.');

      // UFPR também foi usada (turno do Admin em nome da Isa)
      expect((await request(server()).delete(`/schedule/institutions/${ufprId}`).set(asAdmin())).status).toBe(409);

      const temp = await request(server()).post('/schedule/institutions').set(asAdmin()).send({ name: 'Temporária' });
      expect((await request(server()).delete(`/schedule/institutions/${temp.body.id}`).set(asAdmin())).status).toBe(200);
      expect((await request(server()).delete(`/schedule/institutions/${temp.body.id}`).set(asAdmin())).status).toBe(404);
    });
  });

  it('a lista pública de faculdades tem limite próprio (60/min), maior que o dos pedidos de código', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt++) statuses.push((await request(server()).get(`/public/schedule/institutions?organizationId=${orgId}`)).status);
    expect(statuses).not.toContain(429);
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
