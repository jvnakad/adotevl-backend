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

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let profileRepo: Repository<Profile>;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let testOrgId: string;

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

    // Seed: organização e perfis de teste
    const org = await orgRepo.save({ legalName: 'Org Auth Teste', cnpj: '00000000000001' });
    testOrgId = org.id;

    const existingProfiles = await profileRepo.find();
    if (existingProfiles.length === 0) {
      await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
    }
  }, 30000);

  afterAll(async () => {
    // Limpeza dos dados de teste
    await userRepo.delete({ organizationId: testOrgId });
    await orgRepo.delete({ id: testOrgId });
    await app.close();
  }, 30000);

  describe('POST /auth/login', () => {
    it('deve retornar 400 com body inválido', async () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nao-eh-email', password: 123 })
        .expect(400);
    }, 10000);

    it('deve retornar 401 com usuário inexistente', async () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'naoexiste@teste.com', password: 'senha123' })
        .expect(401);
    }, 10000);

    it('deve retornar 401 para conta não confirmada', async () => {
      const profile = await profileRepo.findOne({ where: { name: 'ADMIN' } });

      await request(app.getHttpServer())
        .post('/users')
        .send({
          fullName: 'User Não Confirmado',
          cpf: '11111111101',
          email: 'naoconfirmado@teste.com',
          phone: '11999999901',
          password: 'senha123',
          profileId: profile.id,
          organizationId: testOrgId,
        });

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'naoconfirmado@teste.com', password: 'senha123' });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('confirmada');
    }, 15000);
  });
});
