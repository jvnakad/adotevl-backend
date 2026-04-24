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

describe('Fluxo de ciclo de vida do pet (e2e)', () => {
  let app: INestApplication;
  let profileRepo: Repository<Profile>;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let petRepo: Repository<Pet>;
  let orgId: string;
  let adminToken: string;

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

    // Limpeza prévia
    const existingOrg = await orgRepo.findOne({ where: { cnpj: '33333333333333' } });
    if (existingOrg) {
      await petRepo.delete({ organizationId: existingOrg.id });
      await userRepo.delete({ organizationId: existingOrg.id });
      await orgRepo.delete({ id: existingOrg.id });
    }

    let adminProfile = await profileRepo.findOne({ where: { name: 'ADMIN' } });
    if (!adminProfile) {
      await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
      adminProfile = await profileRepo.findOne({ where: { name: 'ADMIN' } });
    }

    const org = await orgRepo.save({ legalName: 'Org Pet Lifecycle', cnpj: '33333333333333' });
    orgId = org.id;

    const hashed = await bcrypt.hash('senha123', 10);
    await userRepo.save({
      fullName: 'Admin Pet Lifecycle',
      cpf: '55544433300',
      email: 'admin.pet.lifecycle@teste.com',
      phone: '11900000003',
      password: hashed,
      profileId: adminProfile.id,
      organizationId: org.id,
      isConfirmed: true,
      isApproved: true,
      isActive: true,
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin.pet.lifecycle@teste.com', password: 'senha123' });
    adminToken = loginRes.body.access_token;
  }, 30000);

  afterAll(async () => {
    await petRepo.delete({ organizationId: orgId });
    await userRepo.delete({ organizationId: orgId });
    await orgRepo.delete({ id: orgId });
    await app.close();
  }, 30000);

  it('fluxo completo: cadastro → listagem → filtro por status → atualização → remoção', async () => {
    // 1. Admin cadastra um pet
    const createRes = await request(app.getHttpServer())
      .post('/pets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bolinha', species: 'Cachorro', sex: 'M', organizationId: orgId });
    expect(createRes.status).toBe(201);
    const petId = createRes.body.id;
    expect(createRes.body.status).toBe('DISPONIVEL');

    // 2. Pet aparece na listagem geral
    const listRes = await request(app.getHttpServer())
      .get('/pets')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    const found = listRes.body.data.find(p => p.id === petId);
    expect(found).toBeDefined();

    // 3. Pet aparece no filtro por status DISPONIVEL
    const filterRes = await request(app.getHttpServer())
      .get('/pets?status=DISPONIVEL')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(filterRes.status).toBe(200);
    expect(filterRes.body.data.some(p => p.id === petId)).toBe(true);

    // 4. Admin atualiza o status do pet para EM_PROCESSO
    const updateRes = await request(app.getHttpServer())
      .put(`/pets/${petId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'EM_PROCESSO' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.status).toBe('EM_PROCESSO');

    // 5. Pet não aparece mais no filtro DISPONIVEL
    const filterAfterUpdate = await request(app.getHttpServer())
      .get('/pets?status=DISPONIVEL')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(filterAfterUpdate.body.data.some(p => p.id === petId)).toBe(false);

    // 6. Admin remove o pet (soft delete)
    const deleteRes = await request(app.getHttpServer())
      .delete(`/pets/${petId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(200);

    // 7. Pet não aparece mais na listagem
    const listAfterDelete = await request(app.getHttpServer())
      .get('/pets')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listAfterDelete.body.data.some(p => p.id === petId)).toBe(false);
  }, 30000);
});
