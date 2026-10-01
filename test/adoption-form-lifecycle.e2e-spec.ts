import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { TestAppModule } from './test-app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Profile } from '../src/profile/profile.entity';
import { Organization } from '../src/organization/organization.entity';
import { User } from '../src/user/user.entity';
import { AdoptionForm } from '../src/adoption-form/adoption-form.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

// Respostas como o front envia (src/mappers/adoptionForm.ts): tudo string, condicionais escondidas vazias
const baseAnswers = (organizationId: string): Record<string, string> => ({
  fullName: 'Maria Adotante',
  email: 'maria.adotante@teste.com',
  birthDate: '1990-05-10',
  cpf: '12345678909',
  phone: '11987654321',
  phoneIsWhatsapp: 'true',
  occupation: 'Designer',
  zipCode: '01310100',
  street: 'Av Paulista',
  number: '1000',
  complement: '',
  neighborhood: 'Bela Vista',
  city: 'São Paulo',
  state: 'sp',
  hasPets: 'no',
  petsCount: '0',
  petsDescription: '',
  petsNeutered: '',
  petsNotNeuteredReason: '',
  knowsNeuteringImportance: 'yes',
  petsVaccinesUpToDate: 'no_pets',
  catFivFelvTested: 'no_cat',
  awareOfAdaptationPeriod: 'yes',
  desiredAnimal: 'Gato adulto',
  sawAdOn: 'instagram',
  sawAdOnOther: '',
  canAffordCare: 'yes',
  intendedFood: 'Ração premium',
  hasTrustedClinic: 'no',
  trustedClinicName: '',
  residenceType: 'apartment',
  condoPetPolicy: 'Permite animais',
  windowsScreened: 'all_screened',
  housingOwnership: 'rented',
  housingOwnershipOther: '',
  adultsCount: '2',
  childrenCount: '0',
  childrenAges: '',
  everyoneAgrees: 'yes',
  disagreementPlan: 'Conversaríamos',
  hoursAlonePerDay: '8',
  caretakerWhenTraveling: 'Minha mãe',
  pregnancyOpinion: 'Sem problemas',
  plansToMove: 'no',
  moveAnimalPlan: '',
  someoneAllergic: 'no',
  allergyPlan: 'Tratamento médico',
  hasSurrenderedPet: 'no',
  surrenderDetails: '',
  hasLostPetOutside: 'no',
  lostPetDetails: '',
  hadRecentPetDeath: 'no',
  recentDeathDetails: '',
  awareOfLongevity: 'yes',
  willReportChanges: 'yes',
  willNotRehomeWithoutNotice: 'yes',
  idealAnimal: 'Calmo e carinhoso',
  thinkingSince: 'Há um ano',
  awareOfEvaluationProcess: 'yes',
  agreesWithTerms: 'agree',
  declaresTruthful: 'yes',
  organizationId,
});

describe('Fluxo de ciclo de vida da ficha de adoção (e2e)', () => {
  let app: INestApplication;
  let profileRepo: Repository<Profile>;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let formRepo: Repository<AdoptionForm>;
  let orgId: string;
  let otherOrgId: string;
  let adminToken: string;
  let otherAdminToken: string;
  const image = Buffer.from('fake-image');

  const submit = (answers: Record<string, string>, photos = 1, contentType = 'image/jpeg') => {
    let req = request(app.getHttpServer()).post('/adoption-forms');
    Object.entries(answers).forEach(([key, value]) => {
      req = req.field(key, value);
    });
    for (let i = 0; i < photos; i++) {
      req = req.attach('photos', image, { filename: `casa${i}.jpg`, contentType });
    }
    return req;
  };

  const createAdmin = async (email: string, cpf: string, organizationId: string, profileId: string) => {
    await userRepo.save({
      fullName: 'Admin Ficha Adoção',
      cpf,
      email,
      phone: '11900000009',
      password: await bcrypt.hash('senha123', 10),
      profileId,
      organizationId,
      isConfirmed: true,
      isApproved: true,
      isActive: true,
    });
    const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'senha123' });
    return loginRes.body.access_token;
  };

  const cleanup = async (cnpj: string) => {
    const org = await orgRepo.findOne({ where: { cnpj } });
    if (!org) return;
    await formRepo.delete({ organizationId: org.id });
    await userRepo.delete({ organizationId: org.id });
    await orgRepo.delete({ id: org.id });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    profileRepo = moduleFixture.get(getRepositoryToken(Profile));
    orgRepo = moduleFixture.get(getRepositoryToken(Organization));
    userRepo = moduleFixture.get(getRepositoryToken(User));
    formRepo = moduleFixture.get(getRepositoryToken(AdoptionForm));

    await cleanup('44444444444444');
    await cleanup('55555555555555');

    let adminProfile = await profileRepo.findOne({ where: { name: 'ADMIN' } });
    if (!adminProfile) {
      await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
      adminProfile = await profileRepo.findOne({ where: { name: 'ADMIN' } });
    }

    orgId = (await orgRepo.save({ legalName: 'Org Ficha Adoção', cnpj: '44444444444444' })).id;
    otherOrgId = (await orgRepo.save({ legalName: 'Outra Org Ficha Adoção', cnpj: '55555555555555' })).id;

    adminToken = await createAdmin('admin.ficha.adocao@teste.com', '44433322211', orgId, adminProfile.id);
    otherAdminToken = await createAdmin('admin.outra.ficha@teste.com', '44433322212', otherOrgId, adminProfile.id);
  }, 30000);

  afterAll(async () => {
    await cleanup('44444444444444');
    await cleanup('55555555555555');
    await app.close();
  }, 30000);

  it('envio público: valida respostas e fotos', async () => {
    // 1. Ficha completa é aceita sem login e não devolve dados pessoais
    const ok = await submit(baseAnswers(orgId), 2);
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('PENDENTE');
    expect(ok.body.id).toBeDefined();
    expect(ok.body.cpf).toBeUndefined();

    // 2. Sem foto da residência
    const noPhoto = await submit(baseAnswers(orgId), 0);
    expect(noPhoto.status).toBe(400);

    // 3. Arquivo que não é imagem
    const invalidType = await submit(baseAnswers(orgId), 1, 'application/pdf');
    expect(invalidType.status).toBe(400);

    // 4. Mais fotos que o limite
    const tooMany = await submit(baseAnswers(orgId), 7);
    expect(tooMany.status).toBe(400);

    // 5. Opção inválida e CPF mal formatado
    const invalid = await submit({ ...baseAnswers(orgId), cpf: '123', residenceType: 'castle' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toEqual(
      expect.arrayContaining(['CPF deve conter 11 dígitos numéricos.']),
    );

    // 6. Resposta condicional obrigatória faltando (tem clínica, mas sem o nome)
    const missingConditional = await submit({ ...baseAnswers(orgId), hasTrustedClinic: 'yes' });
    expect(missingConditional.status).toBe(400);

    // 7. Tem animais, mas não informou quantos
    const missingPets = await submit({ ...baseAnswers(orgId), hasPets: 'yes', petsCount: '0', petsDescription: 'Um gato', petsNeutered: 'yes' });
    expect(missingPets.status).toBe(400);

    // 8. Não concordou com os termos
    const disagreed = await submit({ ...baseAnswers(orgId), agreesWithTerms: 'disagree' });
    expect(disagreed.status).toBe(400);

    // 9. Organização inexistente
    const unknownOrg = await submit(baseAnswers('00000000-0000-4000-8000-000000000000'));
    expect(unknownOrg.status).toBe(400);
  }, 30000);

  it('fluxo completo: envio → listagem → detalhe → edição → avaliação → fotos → remoção', async () => {
    // 1. Envio público com resposta condicional preenchida
    const createRes = await submit({
      ...baseAnswers(orgId),
      fullName: 'João Candidato',
      email: 'joao.candidato@teste.com',
      hasPets: 'yes',
      petsCount: '2',
      petsDescription: 'Dois gatos',
      petsNeutered: 'no',
      petsNotNeuteredReason: 'Ainda filhotes',
      petsVaccinesUpToDate: 'all_up_to_date',
      catFivFelvTested: 'yes',
    });
    expect(createRes.status).toBe(201);
    const formId = createRes.body.id;

    // 2. Listagem exige login
    const unauth = await request(app.getHttpServer()).get('/adoption-forms');
    expect(unauth.status).toBe(401);

    // 3. Admin vê a ficha na listagem, com busca e filtro de status
    const listRes = await request(app.getHttpServer())
      .get('/adoption-forms?search=joão&status=PENDENTE')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.map((f) => f.id)).toEqual([formId]);

    // 4. Detalhe com tipos convertidos e fotos
    const getRes = await request(app.getHttpServer())
      .get(`/adoption-forms/${formId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.phoneIsWhatsapp).toBe(true);
    expect(getRes.body.petsCount).toBe(2);
    expect(getRes.body.state).toBe('SP');
    expect(getRes.body.fotos).toHaveLength(1);
    expect(getRes.body.fotos[0].url).toContain(`adoption-forms/${formId}/`);

    // 5. Outra organização não enxerga a ficha
    const otherOrg = await request(app.getHttpServer())
      .get(`/adoption-forms/${formId}`)
      .set('Authorization', `Bearer ${otherAdminToken}`);
    expect(otherOrg.status).toBe(404);

    // 6. Edição: sem animais, respostas dependentes são limpas
    const updateRes = await request(app.getHttpServer())
      .put(`/adoption-forms/${formId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hasPets: 'no', occupation: 'Engenheiro' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.occupation).toBe('Engenheiro');
    expect(updateRes.body.petsCount).toBe(0);
    expect(updateRes.body.petsDescription).toBeNull();
    expect(updateRes.body.petsVaccinesUpToDate).toBe('no_pets');

    // 7. Edição que deixa condicional obrigatória sem resposta
    const invalidUpdate = await request(app.getHttpServer())
      .put(`/adoption-forms/${formId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sawAdOn: 'other' });
    expect(invalidUpdate.status).toBe(400);

    // 8. Avaliação
    const statusRes = await request(app.getHttpServer())
      .patch(`/adoption-forms/${formId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APROVADO', reviewNotes: 'Entrevista ok' });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('APROVADO');
    expect(statusRes.body.reviewNotes).toBe('Entrevista ok');
    expect(statusRes.body.reviewedBy).toBeDefined();
    expect(statusRes.body.reviewedAt).toBeDefined();

    const invalidStatus = await request(app.getHttpServer())
      .patch(`/adoption-forms/${formId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'QUALQUER' });
    expect(invalidStatus.status).toBe(400);

    // 9. Fotos: adicionar, respeitar o limite de 6 e remover
    const addRes = await request(app.getHttpServer())
      .post(`/adoption-forms/${formId}/photos`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('photos', image, { filename: 'sala.jpg', contentType: 'image/jpeg' });
    expect(addRes.status).toBe(201);
    expect(addRes.body.fotos).toHaveLength(2);

    let overLimit = request(app.getHttpServer())
      .post(`/adoption-forms/${formId}/photos`)
      .set('Authorization', `Bearer ${adminToken}`);
    for (let i = 0; i < 5; i++) {
      overLimit = overLimit.attach('photos', image, { filename: `extra${i}.jpg`, contentType: 'image/jpeg' });
    }
    expect((await overLimit).status).toBe(400);

    const photoId = addRes.body.fotos[0].id;
    const removePhoto = await request(app.getHttpServer())
      .delete(`/adoption-forms/${formId}/photos/${photoId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(removePhoto.status).toBe(200);

    // 10. Remoção (soft delete): some da listagem e do detalhe
    const deleteRes = await request(app.getHttpServer())
      .delete(`/adoption-forms/${formId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(200);

    const afterDelete = await request(app.getHttpServer())
      .get(`/adoption-forms/${formId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afterDelete.status).toBe(404);

    const listAfterDelete = await request(app.getHttpServer())
      .get('/adoption-forms')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listAfterDelete.body.data.some((f) => f.id === formId)).toBe(false);
  }, 30000);
});
