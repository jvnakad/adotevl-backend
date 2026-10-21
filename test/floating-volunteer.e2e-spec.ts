import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestAppModule, cleanupAccess } from './test-app.module';
import { Profile } from '../src/profile/profile.entity';
import { Organization } from '../src/organization/organization.entity';
import { User } from '../src/user/user.entity';
import { Volunteer } from '../src/volunteer/volunteer.entity';

describe('Cadastro de voluntário volante (e2e)', () => {
  let app: INestApplication;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let volunteerRepo: Repository<Volunteer>;
  let orgId: string;

  const floating = () => ({
    fullName: 'Bia Volante',
    cpf: '55544433380',
    email: 'bia.volante@teste.com',
    phone: '41999998888',
    birthDate: '1996-03-15',
    consent: true,
    organizationId: orgId,
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    // Servidor escutando de verdade: sem isso o supertest abre uma porta por requisicao e, com muitas em paralelo, o CI derruba conexoes (ECONNRESET)
    await app.listen(0);

    orgRepo = moduleFixture.get(getRepositoryToken(Organization));
    userRepo = moduleFixture.get(getRepositoryToken(User));
    volunteerRepo = moduleFixture.get(getRepositoryToken(Volunteer));
    const profileRepo: Repository<Profile> = moduleFixture.get(getRepositoryToken(Profile));

    const existingOrg = await orgRepo.findOne({ where: { cnpj: '55555555555555' } });
    if (existingOrg) {
      await cleanupAccess(app, existingOrg.id);
      await userRepo.delete({ organizationId: existingOrg.id });
      await orgRepo.delete({ id: existingOrg.id });
    }
    if (!(await profileRepo.findOne({ where: { name: 'VOLUNTEER' } }))) {
      await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
    }
    orgId = (await orgRepo.save({ legalName: 'Org Volantes', cnpj: '55555555555555' })).id;
  }, 30000);

  afterAll(async () => {
    await cleanupAccess(app, orgId);
    await userRepo.delete({ organizationId: orgId });
    await orgRepo.delete({ id: orgId });
    await app.close();
  }, 30000);

  it('cadastra sem senha, já aprovado e na equipe Voluntário Volante', async () => {
    const res = await request(app.getHttpServer()).post('/users/floating').send(floating());

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), fullName: 'Bia Volante', email: 'bia.volante@teste.com' });

    const user = await userRepo.findOne({ where: { id: res.body.id } });
    expect(user).toEqual(expect.objectContaining({ isApproved: true, isConfirmed: true, consentAt: expect.any(Date) }));
    expect(user.password).toMatch(/^\$2[aby]\$/);

    const volunteer = await volunteerRepo.findOne({ where: { userId: user.id }, relations: { team: true } });
    expect(volunteer.team).toEqual(expect.objectContaining({ name: 'Voluntário Volante', systemKey: 'FLOATING_VOLUNTEER' }));
  });

  it('email repetido responde 409', async () => {
    const res = await request(app.getHttpServer()).post('/users/floating').send({ ...floating(), cpf: '11122233396' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Já existe um usuário cadastrado com este e-mail.');
  });

  it('sem aceite LGPD ou sem celular responde 400', async () => {
    const noConsent = await request(app.getHttpServer())
      .post('/users/floating')
      .send({ ...floating(), email: 'sem.aceite@teste.com', cpf: '22233344405', consent: false });
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.message).toContain('É preciso autorizar o uso dos dados para contato sobre voluntariado.');

    const { phone, ...noPhone } = floating();
    const missingPhone = await request(app.getHttpServer())
      .post('/users/floating')
      .send({ ...noPhone, email: 'sem.celular@teste.com', cpf: '33344455508' });
    expect(missingPhone.status).toBe(400);
  });

  it('honeypot preenchido finge sucesso e não cria usuário', async () => {
    const res = await request(app.getHttpServer())
      .post('/users/floating')
      .send({ ...floating(), email: 'robo@teste.com', cpf: '44455566619', website: 'http://spam.test' });

    expect(res.status).toBe(201);
    expect(await userRepo.findOne({ where: { email: 'robo@teste.com' } })).toBeNull();
  });

  // Por último: esgota o limite de cadastros por minuto deste IP
  it('limita cadastros por IP (429)', async () => {
    const statuses: number[] = [];
    const validCpfs = ['66655544068', '66655544149', '66655544220', '66655544300', '66655544491', '66655544572'];
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await request(app.getHttpServer())
        .post('/users/floating')
        .send({ ...floating(), email: `limite${attempt}@teste.com`, cpf: validCpfs[attempt] });
      statuses.push(res.status);
    }

    expect(statuses).toContain(429);
  });
});
