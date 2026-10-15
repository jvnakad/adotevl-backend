import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { TestAppModule, joinTeam, cleanupAccess, VOLUNTEER_APPLICATION } from './test-app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Profile } from '../src/profile/profile.entity';
import { Organization } from '../src/organization/organization.entity';
import { User } from '../src/user/user.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

describe('Fluxo de ciclo de vida do usuário (e2e)', () => {
  let app: INestApplication;
  let profileRepo: Repository<Profile>;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let orgId: string;
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    profileRepo = moduleFixture.get(getRepositoryToken(Profile));
    orgRepo = moduleFixture.get(getRepositoryToken(Organization));
    userRepo = moduleFixture.get(getRepositoryToken(User));

    // Limpeza prévia
    const existingOrg = await orgRepo.findOne({ where: { cnpj: '22222222222222' } });
    if (existingOrg) {
      await cleanupAccess(app, existingOrg.id);
      await userRepo.delete({ organizationId: existingOrg.id });
      await orgRepo.delete({ id: existingOrg.id });
    }

    let adminProfile = await profileRepo.findOne({ where: { name: 'ADMIN' } });
    if (!adminProfile) {
      await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
      adminProfile = await profileRepo.findOne({ where: { name: 'ADMIN' } });
    }

    const org = await orgRepo.save({ legalName: 'Org User Lifecycle', cnpj: '22222222222222' });
    orgId = org.id;

    const hashed = await bcrypt.hash('senha123', 10);
    const admin = await userRepo.save({
      fullName: 'Admin Lifecycle',
      cpf: '11111111100',
      email: 'admin.lifecycle@teste.com',
      phone: '11900000001',
      password: hashed,
      profileId: adminProfile.id,
      organizationId: org.id,
      isConfirmed: true,
      isApproved: true,
      isActive: true,
    });
    adminId = admin.id;
    await joinTeam(app, admin, 'ADMIN');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin.lifecycle@teste.com', password: 'senha123' });
    adminToken = loginRes.body.access_token;
  }, 30000);

  afterAll(async () => {
    await cleanupAccess(app, orgId);
    await userRepo.delete({ organizationId: orgId });
    await orgRepo.delete({ id: orgId });
    await app.close();
  }, 30000);

  it('fluxo completo: cadastro → confirmação → login bloqueado → aprovação → login → edição de perfil', async () => {
    const volunteerProfile = await profileRepo.findOne({ where: { name: 'VOLUNTEER' } });

    // 1. Novo usuário se cadastra
    const createRes = await request(app.getHttpServer())
      .post('/users')
      .send({
        fullName: 'Voluntário Novo',
        cpf: '99988877700',
        email: 'voluntario.novo@teste.com',
        phone: '11900000002',
        birthDate: '1990-04-20',
        password: 'senha123',
        profileId: volunteerProfile.id,
        consent: true,
        application: VOLUNTEER_APPLICATION,
        organizationId: orgId,
      });
    expect(createRes.status).toBe(201);
    // Resposta pública não expõe hash da senha nem código de confirmação (o código chega por e-mail)
    expect(createRes.body).toEqual({ id: expect.any(String), email: 'voluntario.novo@teste.com' });
    const userId = createRes.body.id;
    const { confirmationCode } = await userRepo.findOne({ where: { id: userId } });

    // Admin lê o questionário respondido no cadastro
    const applicationRes = await request(app.getHttpServer())
      .get(`/users/${userId}/application`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(applicationRes.status).toBe(200);
    expect(applicationRes.body).toEqual(expect.objectContaining({ city: 'Curitiba', tools: ['CANVA', 'INSTAGRAM'] }));

    // 2. Confirma o e-mail via código
    const confirmRes = await request(app.getHttpServer())
      .patch(`/users/confirm/${confirmationCode}`);
    expect(confirmRes.status).toBe(200);

    // 3. Tenta logar antes de ser aprovado — deve falhar
    const loginBeforeApproval = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'voluntario.novo@teste.com', password: 'senha123' });
    expect(loginBeforeApproval.status).toBe(401);

    // 4. Admin cria a equipe e define o acesso: só visualizar Pets
    const teamRes = await request(app.getHttpServer())
      .post('/teams')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Resgate' });
    expect(teamRes.status).toBe(201);
    const teamId = teamRes.body.id;
    const permsRes = await request(app.getHttpServer())
      .put(`/teams/${teamId}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissions: { PETS: 'VIEW' } });
    expect(permsRes.status).toBe(200);
    expect(permsRes.body.permissions).toEqual(expect.objectContaining({ PETS: 'VIEW', FINANCIAL: 'NONE' }));

    // 4.1 Aprovar exige a equipe
    const approveWithoutTeam = await request(app.getHttpServer())
      .patch(`/users/${userId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(approveWithoutTeam.status).toBe(400);

    // 4.2 Admin aprova o usuário na equipe
    const approveRes = await request(app.getHttpServer())
      .patch(`/users/${userId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ teamId });
    expect(approveRes.status).toBe(200);

    // 5. Usuário faz login com sucesso
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'voluntario.novo@teste.com', password: 'senha123' });
    expect(loginRes.status).toBe(201);
    const userToken = loginRes.body.access_token;

    // 5.1 Acesso vem da equipe: vê pets, não cadastra, não entra no financeiro nem aprova ninguém
    const meRes = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${userToken}`);
    expect(meRes.body.access).toEqual(expect.objectContaining({ teamId, teamName: 'Resgate', isAdmin: false }));
    expect(meRes.body.access.permissions).toEqual({ PETS: 'VIEW' });
    expect((await request(app.getHttpServer()).get('/pets').set('Authorization', `Bearer ${userToken}`)).status).toBe(200);
    const createPet = await request(app.getHttpServer())
      .post('/pets')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Bob', species: 'Cachorro', sex: 'Macho', birthDate: '2020-01', organizationId: orgId });
    expect(createPet.status).toBe(403);
    expect(createPet.body.message).toBe('Sua equipe só pode visualizar Pets.');
    expect((await request(app.getHttpServer()).get('/financial/balance').set('Authorization', `Bearer ${userToken}`)).status).toBe(403);
    expect((await request(app.getHttpServer()).patch(`/users/${adminId}/approve`).set('Authorization', `Bearer ${userToken}`).send({ teamId })).status).toBe(403);

    // 5.2 Último membro não sai da equipe Admin
    const lastAdmin = await request(app.getHttpServer())
      .patch(`/users/${adminId}/team`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ teamId });
    expect(lastAdmin.status).toBe(400);

    // 6. Usuário edita o próprio perfil
    const editRes = await request(app.getHttpServer())
      .patch(`/users/${userId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ fullName: 'Voluntário Atualizado' });
    expect(editRes.status).toBe(200);
    expect(editRes.body.fullName).toBe('Voluntário Atualizado');

    // 7. Admin busca o usuário diretamente e confirma aprovação
    const getRes = await request(app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.isApproved).toBe(true);
    expect(getRes.body.fullName).toBe('Voluntário Atualizado');
  }, 30000);

  it('tutoriais: marca tour visto, desliga e zera pelo /users/me/tutorial', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };

    const seen = await request(app.getHttpServer()).patch('/users/me/tutorial').set(auth).send({ tour: 'PETS', version: 1 });
    expect(seen.status).toBe(200);
    expect(seen.body).toEqual({ tours: { PETS: 1 }, disabled: false });

    const disabled = await request(app.getHttpServer()).patch('/users/me/tutorial').set(auth).send({ disabled: true });
    expect(disabled.body).toEqual({ tours: { PETS: 1 }, disabled: true });

    const me = await request(app.getHttpServer()).get('/auth/me').set(auth);
    expect(me.body.tutorialProgress).toEqual({ tours: { PETS: 1 }, disabled: true });

    const invalid = await request(app.getHttpServer()).patch('/users/me/tutorial').set(auth).send({ tour: 'PETS' });
    expect(invalid.status).toBe(400);

    const reset = await request(app.getHttpServer()).delete('/users/me/tutorial').set(auth);
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ tours: {}, disabled: false });
  });
});
