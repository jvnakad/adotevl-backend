import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { TestAppModule } from './test-app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Profile } from '../src/profile/profile.entity';
import { Organization } from '../src/organization/organization.entity';
import { User } from '../src/user/user.entity';
import { Pet } from '../src/pet/pet.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

describe('Pets (e2e)', () => {
  let app: INestApplication;
  let profileRepo: Repository<Profile>;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let petRepo: Repository<Pet>;
  let adminToken: string;
  let orgId: string;

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
    petRepo = moduleFixture.get(getRepositoryToken(Pet));

    // Limpeza prévia de dados de execuções anteriores
    const existingOrg = await orgRepo.findOne({ where: { cnpj: '11111111111111' } });
    if (existingOrg) {
      await petRepo.delete({ organizationId: existingOrg.id });
      await userRepo.delete({ organizationId: existingOrg.id });
      await orgRepo.delete({ id: existingOrg.id });
    }

    // Seed profiles se não existirem
    let adminProfile = await profileRepo.findOne({ where: { name: 'ADMIN' } });
    if (!adminProfile) {
      await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
      adminProfile = await profileRepo.findOne({ where: { name: 'ADMIN' } });
    }

    const org = await orgRepo.save({ legalName: 'Org Pets', cnpj: '11111111111111' });
    orgId = org.id;

    // Cria admin diretamente no banco (já confirmado e aprovado)
    const hashed = await bcrypt.hash('senha123', 10);
    await userRepo.save({
      fullName: 'Admin Pets',
      cpf: '98765432100',
      email: 'adminpets@teste.com',
      phone: '11988888888',
      password: hashed,
      profileId: adminProfile.id,
      organizationId: org.id,
      isConfirmed: true,
      isApproved: true,
      isActive: true,
    });

    // Login
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'adminpets@teste.com', password: 'senha123' });

    adminToken = res.body.access_token;
  }, 30000);

  afterAll(async () => {
    await petRepo.delete({ organizationId: orgId });
    await userRepo.delete({ organizationId: orgId });
    await orgRepo.delete({ id: orgId });
    await app.close();
  }, 30000);

  describe('POST /pets', () => {
    it('deve retornar 401 sem token', async () => {
      return request(app.getHttpServer())
        .post('/pets')
        .send({ name: 'Rex', species: 'Cachorro', sex: 'M', organizationId: orgId })
        .expect(401);
    });

    it('deve cadastrar pet com sucesso', async () => {
      const res = await request(app.getHttpServer())
        .post('/pets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Rex', species: 'Cachorro', sex: 'M', organizationId: orgId });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Rex');
      expect(res.body.status).toBe('DISPONIVEL');
    });
  });

  describe('GET /pets', () => {
    it('deve listar pets da organização', async () => {
      const res = await request(app.getHttpServer())
        .get('/pets')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('deve filtrar pets por status', async () => {
      const res = await request(app.getHttpServer())
        .get('/pets?status=DISPONIVEL')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.every(p => p.status === 'DISPONIVEL')).toBe(true);
    });
  });
});
