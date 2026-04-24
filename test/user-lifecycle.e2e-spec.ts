import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { TestAppModule } from './test-app.module';
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

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin.lifecycle@teste.com', password: 'senha123' });
    adminToken = loginRes.body.access_token;
  }, 30000);

  afterAll(async () => {
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
        password: 'senha123',
        profileId: volunteerProfile.id,
        organizationId: orgId,
      });
    expect(createRes.status).toBe(201);
    const userId = createRes.body.id;
    const confirmationCode = createRes.body.confirmationCode;

    // 2. Confirma o e-mail via código
    const confirmRes = await request(app.getHttpServer())
      .patch(`/users/confirm/${confirmationCode}`);
    expect(confirmRes.status).toBe(200);

    // 3. Tenta logar antes de ser aprovado — deve falhar
    const loginBeforeApproval = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'voluntario.novo@teste.com', password: 'senha123' });
    expect(loginBeforeApproval.status).toBe(401);

    // 4. Admin aprova o usuário
    const approveRes = await request(app.getHttpServer())
      .patch(`/users/${userId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approveRes.status).toBe(200);

    // 5. Usuário faz login com sucesso
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'voluntario.novo@teste.com', password: 'senha123' });
    expect(loginRes.status).toBe(201);
    const userToken = loginRes.body.access_token;

    // 6. Usuário edita o próprio perfil
    const editRes = await request(app.getHttpServer())
      .patch(`/users/${userId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ fullName: 'Voluntário Atualizado' });
    expect(editRes.status).toBe(200);
    expect(editRes.body.fullName).toBe('Voluntário Atualizado');

    // 7. Admin lista usuários e o novo aparece
    const listRes = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    const found = listRes.body.data.find(u => u.id === userId);
    expect(found).toBeDefined();
    expect(found.isApproved).toBe(true);
  }, 30000);
});
