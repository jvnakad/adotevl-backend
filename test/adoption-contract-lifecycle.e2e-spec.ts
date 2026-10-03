import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { TestAppModule } from './test-app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { createHmac } from 'crypto';
import { Profile } from '../src/profile/profile.entity';
import { Organization } from '../src/organization/organization.entity';
import { User } from '../src/user/user.entity';
import { Pet } from '../src/pet/pet.entity';
import { AdoptionForm } from '../src/adoption-form/adoption-form.entity';
import { AutentiqueService } from '../src/autentique/autentique.service';
import { MockAutentiqueService } from './test-app.module';

const WEBHOOK_SECRET = 'segredo-webhook-e2e';

// Respostas mínimas válidas, como o front envia (multipart, tudo string)
const answers = (organizationId: string): Record<string, string> => ({
  fullName: 'Carla Contrato',
  email: 'carla.contrato@teste.com',
  birthDate: '1992-03-15',
  cpf: '52998224725',
  phone: '41987654321',
  phoneIsWhatsapp: 'true',
  occupation: 'Professora',
  zipCode: '80010000',
  street: 'Rua das Flores',
  number: '100',
  complement: 'Apto 12',
  neighborhood: 'Centro',
  city: 'Curitiba',
  state: 'PR',
  hasPets: 'no',
  petsCount: '0',
  knowsNeuteringImportance: 'yes',
  petsVaccinesUpToDate: 'no_pets',
  catFivFelvTested: 'no_cat',
  awareOfAdaptationPeriod: 'yes',
  desiredAnimal: 'Cachorro adulto',
  sawAdOn: 'instagram',
  canAffordCare: 'yes',
  intendedFood: 'Premium',
  hasTrustedClinic: 'no',
  residenceType: 'house',
  windowsScreened: 'not_adopting_cat',
  housingOwnership: 'owned',
  adultsCount: '2',
  childrenCount: '0',
  everyoneAgrees: 'yes',
  disagreementPlan: 'Conversar',
  hoursAlonePerDay: '4',
  caretakerWhenTraveling: 'Mãe',
  pregnancyOpinion: 'Fica',
  plansToMove: 'no',
  someoneAllergic: 'no',
  allergyPlan: 'Tratar',
  hasSurrenderedPet: 'no',
  hasLostPetOutside: 'no',
  hadRecentPetDeath: 'no',
  awareOfLongevity: 'yes',
  willReportChanges: 'yes',
  willNotRehomeWithoutNotice: 'yes',
  idealAnimal: 'Calmo',
  thinkingSince: '1 ano',
  awareOfEvaluationProcess: 'yes',
  agreesWithTerms: 'agree',
  declaresTruthful: 'yes',
  organizationId,
});

// Dia local (Brasil, UTC-3) para os filtros do histórico
const localToday = () => new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe('Fluxo do termo de adoção (e2e)', () => {
  let app: INestApplication;
  let profileRepo: Repository<Profile>;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let petRepo: Repository<Pet>;
  let formRepo: Repository<AdoptionForm>;
  let autentique: MockAutentiqueService;
  let orgId: string;
  let adminToken: string;
  let volunteerToken: string;
  let otherAdminToken: string;

  const CNPJ = '66666666666666';
  const OTHER_CNPJ = '77777777777777';

  const api = () => request(app.getHttpServer());
  const auth = (req, token = adminToken) => req.set('Authorization', `Bearer ${token}`);

  const createUser = async (email: string, cpf: string, organizationId: string, profileName: string) => {
    const profile = await profileRepo.findOne({ where: { name: profileName } });
    await userRepo.save({
      fullName: `Usuário ${profileName} Contrato`,
      cpf,
      email,
      phone: '41900000000',
      password: await bcrypt.hash('senha123', 10),
      profileId: profile.id,
      organizationId,
      isConfirmed: true,
      isApproved: true,
      isActive: true,
    });
    const login = await api().post('/auth/login').send({ email, password: 'senha123' });
    return login.body.access_token;
  };

  const cleanup = async (cnpj: string) => {
    const org = await orgRepo.findOne({ where: { cnpj } });
    if (!org) return;
    // Fichas primeiro: histórico e contrato saem em cascata
    await formRepo.delete({ organizationId: org.id });
    await petRepo.delete({ organizationId: org.id });
    await userRepo.delete({ organizationId: org.id });
    await orgRepo.delete({ id: org.id });
  };

  const submitForm = () => {
    let req = api().post('/adoption-forms');
    Object.entries(answers(orgId)).forEach(([key, value]) => {
      req = req.field(key, value);
    });
    return req.attach('photos', Buffer.from('fake-image'), { filename: 'casa.jpg', contentType: 'image/jpeg' });
  };

  const fullClauses = (contract, change: (clause) => any = (clause) => clause) =>
    contract.clauses.map(({ key, order, content, removed }) => change({ key, order, content, removed }));

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    // rawBody como no main.ts: o webhook valida o HMAC sobre o corpo original
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    profileRepo = moduleFixture.get(getRepositoryToken(Profile));
    orgRepo = moduleFixture.get(getRepositoryToken(Organization));
    userRepo = moduleFixture.get(getRepositoryToken(User));
    petRepo = moduleFixture.get(getRepositoryToken(Pet));
    formRepo = moduleFixture.get(getRepositoryToken(AdoptionForm));
    autentique = moduleFixture.get(AutentiqueService);
    process.env.AUTENTIQUE_WEBHOOK_SECRET = WEBHOOK_SECRET;

    await cleanup(CNPJ);
    await cleanup(OTHER_CNPJ);

    if (!(await profileRepo.findOne({ where: { name: 'VOLUNTEER' } }))) {
      await profileRepo.save([{ name: 'ADMIN' }, { name: 'FINANCIAL' }, { name: 'VOLUNTEER' }]);
    }

    orgId = (await orgRepo.save({ legalName: 'Org Contrato Adoção', cnpj: CNPJ })).id;
    const otherOrgId = (await orgRepo.save({ legalName: 'Outra Org Contrato', cnpj: OTHER_CNPJ })).id;

    adminToken = await createUser('admin.contrato@teste.com', '66655544411', orgId, 'ADMIN');
    volunteerToken = await createUser('voluntario.contrato@teste.com', '66655544412', orgId, 'VOLUNTEER');
    otherAdminToken = await createUser('admin.outra.contrato@teste.com', '66655544413', otherOrgId, 'ADMIN');
  }, 30000);

  afterAll(async () => {
    await cleanup(CNPJ);
    await cleanup(OTHER_CNPJ);
    await app.close();
  }, 30000);

  it('aprovar → contrato → remover cláusula → gerar → concluir → histórico', async () => {
    const rex = await petRepo.save({ name: 'Rex', species: 'Cachorro', sex: 'Macho', animal: 'Vira-lata', age: 3, castration: true, organizationId: orgId });
    const adopted = await petRepo.save({ name: 'Bidu', species: 'Cachorro', sex: 'Macho', status: 'ADOTADO' as any, organizationId: orgId });

    // 1. Ficha pública entra como PENDENTE, com evento do formulário público
    const created = await submitForm();
    expect(created.status).toBe(201);
    const formId = created.body.id;

    const initialHistory = await auth(api().get(`/adoption-forms/${formId}/history`));
    expect(initialHistory.status).toBe(200);
    expect(initialHistory.body).toEqual([expect.objectContaining({ type: 'FICHA_CRIADA', userName: 'Formulário público', adopterName: 'Carla Contrato' })]);

    // 2. Kanban com as 5 colunas
    const board = await auth(api().get('/adoption-forms/board?search=carla'));
    expect(board.status).toBe(200);
    expect(board.body.columns.map((c) => c.status)).toEqual(['PENDENTE', 'APROVADO', 'AGUARDANDO_ASSINATURA', 'CONCLUIDA', 'REPROVADO']);
    expect(board.body.columns[0].items.map((i) => i.id)).toEqual([formId]);
    expect(board.body.columns[0].items[0]).toEqual(expect.objectContaining({ petId: null, petName: null }));

    // 3. Contrato antes da aprovação e transições proibidas
    expect((await auth(api().get(`/adoption-forms/${formId}/contract`))).status).toBe(400);
    const manualContract = await auth(api().patch(`/adoption-forms/${formId}/status`)).send({ status: 'CONTRATO_GERADO' });
    expect(manualContract.status).toBe(400);
    expect(manualContract.body.message).toBe('Movimentação de status não permitida.');
    expect((await auth(api().patch(`/adoption-forms/${formId}/status`)).send({ status: 'CONCLUIDA' })).status).toBe(400);
    // Mesmo status: só atualiza as observações
    const sameStatus = await auth(api().patch(`/adoption-forms/${formId}/status`)).send({ status: 'PENDENTE', reviewNotes: 'Aguardando entrevista' });
    expect(sameStatus.status).toBe(200);
    expect(sameStatus.body.reviewNotes).toBe('Aguardando entrevista');

    // 4. Aprovação
    const approved = await auth(api().patch(`/adoption-forms/${formId}/status`)).send({ status: 'APROVADO', reviewNotes: 'Entrevista ok' });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APROVADO');
    expect(approved.body.pet).toBeNull();

    // 5. Rascunho criado a partir do modelo
    const draft = await auth(api().get(`/adoption-forms/${formId}/contract`));
    expect(draft.status).toBe(200);
    expect(draft.body.version).toBe(0);
    expect(draft.body.pdfUrl).toBeNull();
    expect(draft.body.clauses).toHaveLength(14);
    expect(draft.body.clauses[0]).toEqual(expect.objectContaining({ key: 'animal', locked: true, removed: false }));
    expect(draft.body.data.adopter).toEqual(expect.objectContaining({ name: 'Carla Contrato', cpf: '52998224725', birthDate: '1992-03-15', profession: 'Professora' }));
    expect(draft.body.data.adopter.address).toBe('Rua das Flores, nº 100 - Apto 12 - Centro - Curitiba/PR - CEP 80010-000');
    expect(draft.body.data.signature).toEqual({ city: 'Curitiba/PR', date: null });

    // 6. Gerar sem pet
    const noPet = await auth(api().post(`/adoption-forms/${formId}/contract/generate`));
    expect(noPet.status).toBe(400);
    expect(noPet.body.message).toBe('Vincule um pet antes de gerar o termo de adoção.');

    // 7. Vincular pet: adotado é recusado; disponível é reservado e preenche o animal
    expect((await auth(api().put(`/adoption-forms/${formId}/contract`)).send({ petId: adopted.id })).status).toBe(400);
    const linked = await auth(api().put(`/adoption-forms/${formId}/contract`)).send({ petId: rex.id });
    expect(linked.status).toBe(200);
    expect(linked.body.petId).toBe(rex.id);
    expect(linked.body.pet).toEqual(expect.objectContaining({ id: rex.id, name: 'Rex' }));
    expect(linked.body.data.animal).toEqual(expect.objectContaining({ name: 'Rex', species: 'CANINA', sex: 'MACHO', breed: 'Vira-lata', castrated: true }));
    expect((await petRepo.findOne({ where: { id: rex.id } })).status).toBe('EM_PROCESSO');

    // 8. Validações das cláusulas
    const lockedRemoval = await auth(api().put(`/adoption-forms/${formId}/contract`)).send({
      clauses: fullClauses(linked.body, (c) => (c.key === 'animal' ? { ...c, removed: true } : c)),
    });
    expect(lockedRemoval.status).toBe(400);
    const missing = await auth(api().put(`/adoption-forms/${formId}/contract`)).send({ clauses: fullClauses(linked.body).slice(1) });
    expect(missing.status).toBe(400);
    const invalidData = await auth(api().put(`/adoption-forms/${formId}/contract`)).send({ data: { animal: { species: 'EQUINA' } } });
    expect(invalidData.status).toBe(400);
    expect(invalidData.body.message).toEqual(['Espécie do animal deve ser CANINA ou FELINA.']);

    // 9. Remove a 3ª cláusula, edita a multa e preenche RG/data
    const edited = await auth(api().put(`/adoption-forms/${formId}/contract`)).send({
      data: { ...linked.body.data, adopter: { ...linked.body.data.adopter, rg: '12.345.678-9' }, signature: { city: 'Curitiba/PR', date: '2026-10-02' } },
      clauses: fullClauses(linked.body, (c) => {
        if (c.key === 'vacina_castracao') return { ...c, removed: true };
        if (c.key === 'multa') return { ...c, content: 'Multa de R$ 2.000,00 (dois mil reais).' };
        return c;
      }),
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data.adopter.rg).toBe('12.345.678-9');
    expect(edited.body.clauses.find((c) => c.key === 'vacina_castracao').removed).toBe(true);

    // 10. Voltar a multa ao texto original
    const reset = await auth(api().post(`/adoption-forms/${formId}/contract/clauses/multa/reset`));
    expect(reset.status).toBe(201);
    const multa = reset.body.clauses.find((c) => c.key === 'multa');
    expect(multa.content).toBe(multa.originalContent);

    // 11. Gera o PDF: versão 1, ficha continua em APROVADO
    const generated = await auth(api().post(`/adoption-forms/${formId}/contract/generate`));
    expect(generated.status).toBe(201);
    expect(generated.body.version).toBe(1);
    expect(generated.body.pdfUrl).toContain(`contracts/${formId}/v1.pdf`);
    expect(generated.body.versions).toEqual([expect.objectContaining({ version: 1, userName: 'Usuário ADMIN Contrato' })]);
    expect(generated.body.generatedAt).toBeDefined();

    const afterGenerate = await auth(api().get(`/adoption-forms/${formId}`));
    expect(afterGenerate.body.status).toBe('APROVADO');
    expect(afterGenerate.body.pet).toEqual(expect.objectContaining({ id: rex.id, name: 'Rex' }));

    // 12a. Concluir nunca é manual: só a assinatura conclui
    const notSigned = await auth(api().patch(`/adoption-forms/${formId}/status`), volunteerToken).send({ status: 'CONCLUIDA' });
    expect(notSigned.status).toBe(400);
    expect(notSigned.body.message).toBe('A adoção é concluída automaticamente quando o adotante assina o termo de adoção.');
    expect((await auth(api().patch(`/adoption-forms/${formId}/status`)).send({ status: 'AGUARDANDO_ASSINATURA' })).status).toBe(400);

    // 12b. Envia para assinatura: ficha aguardando, contrato só leitura
    const sent = await auth(api().post(`/adoption-forms/${formId}/contract/signature`), volunteerToken);
    expect(sent.status).toBe(201);
    expect(sent.body.signature).toEqual(expect.objectContaining({ status: 'PENDENTE', email: 'carla.contrato@teste.com', version: 1, signedPdfUrl: null }));
    expect((await auth(api().get(`/adoption-forms/${formId}`))).body.status).toBe('AGUARDANDO_ASSINATURA');
    const lockedEdit = await auth(api().put(`/adoption-forms/${formId}/contract`)).send({ data: {} });
    expect(lockedEdit.status).toBe(400);
    expect(lockedEdit.body.message).toBe('O termo de adoção já foi enviado para assinatura e não pode mais ser alterado.');
    expect((await auth(api().post(`/adoption-forms/${formId}/contract/signature`))).status).toBe(400);
    const firstDocumentId = [...autentique.documents.keys()].pop();
    // A associação já assinou no envio; falta só o adotante
    expect(autentique.documents.get(firstDocumentId).organizationSigned).toBe(true);
    // Voluntário não tira a ficha de Aguardando assinatura
    const volunteerReopen = await auth(api().patch(`/adoption-forms/${formId}/status`), volunteerToken).send({ status: 'APROVADO' });
    expect(volunteerReopen.status).toBe(403);

    // 12c. Cancelar envio: só ADMIN; ficha volta para Aprovado e o documento some do Autentique
    expect((await auth(api().delete(`/adoption-forms/${formId}/contract/signature`), volunteerToken)).status).toBe(403);
    const cancelled = await auth(api().delete(`/adoption-forms/${formId}/contract/signature`));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.signature.status).toBe('CANCELADO');
    expect(autentique.documents.has(firstDocumentId)).toBe(false);
    expect((await auth(api().get(`/adoption-forms/${formId}`))).body.status).toBe('APROVADO');

    // 12d. Reenvia; sincronizar antes de assinar não muda nada
    expect((await auth(api().post(`/adoption-forms/${formId}/contract/signature`))).status).toBe(201);
    const documentId = [...autentique.documents.keys()].pop();
    const pending = await auth(api().post(`/adoption-forms/${formId}/contract/signature/sync`));
    expect(pending.status).toBe(201);
    expect(pending.body.signature.status).toBe('PENDENTE');

    // 12e. Webhook: HMAC inválido é recusado; válido marca o termo como assinado e conclui a adoção
    autentique.adopterSigns(documentId);
    const webhookBody = JSON.stringify({ id: 'wh-1', object: 'webhook', event: { id: 'ev-1', type: 'signature.accepted', data: { document: documentId } } });
    const webhook = (signature: string) =>
      api().post('/webhooks/autentique').set('Content-Type', 'application/json').set('X-Autentique-Signature', signature).send(webhookBody);
    expect((await webhook('assinatura-falsa')).status).toBe(401);
    const accepted = await webhook(createHmac('sha256', WEBHOOK_SECRET).update(webhookBody).digest('hex'));
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ received: true, ignored: false });

    const signedContract = await auth(api().get(`/adoption-forms/${formId}/contract`));
    expect(signedContract.body.signature).toEqual(expect.objectContaining({ status: 'ASSINADO', signedAt: expect.any(String) }));
    expect(signedContract.body.signature.signedPdfUrl).toContain(`contracts/${formId}/assinado-v1.pdf`);
    expect((await auth(api().get(`/adoption-forms/${formId}`))).body.status).toBe('CONCLUIDA');
    const signedBoard = await auth(api().get('/adoption-forms/board?search=carla'));
    expect(signedBoard.body.columns.find((c) => c.status === 'CONCLUIDA').items.map((i) => i.id)).toEqual([formId]);

    // 13. Adoção concluída pela assinatura: pet adotado
    const adoptedRex = await petRepo.findOne({ where: { id: rex.id } });
    expect(adoptedRex.status).toBe('ADOTADO');
    expect(adoptedRex.adoptionDate).toBeTruthy();

    // 14. Contrato de adoção concluída: leitura sim, edição não
    expect((await auth(api().get(`/adoption-forms/${formId}/contract`))).status).toBe(200);
    const readOnly = await auth(api().put(`/adoption-forms/${formId}/contract`)).send({ data: {} });
    expect(readOnly.status).toBe(400);
    expect(readOnly.body.message).toBe('Adoção concluída: o termo de adoção não pode mais ser alterado.');

    // 15. Histórico da ficha com tudo, mais recente primeiro
    const formHistory = await auth(api().get(`/adoption-forms/${formId}/history`));
    expect(formHistory.status).toBe(200);
    const types = formHistory.body.map((event) => event.type);
    // Assinatura e conclusão são gravadas juntas (mesmo instante)
    expect(types.slice(0, 2)).toEqual(expect.arrayContaining(['CONTRATO_ASSINADO', 'ADOCAO_CONCLUIDA']));
    expect(types).toEqual(
      expect.arrayContaining([
        'FICHA_CRIADA',
        'STATUS_ALTERADO',
        'PET_VINCULADO',
        'CONTRATO_DADOS_ALTERADOS',
        'CLAUSULA_REMOVIDA',
        'CLAUSULA_EDITADA',
        'CONTRATO_GERADO',
        'CONTRATO_ENVIADO_ASSINATURA',
        'ASSINATURA_CANCELADA',
        'CONTRATO_ASSINADO',
        'ADOCAO_CONCLUIDA',
      ]),
    );
    expect(formHistory.body.find((event) => event.type === 'CONTRATO_ASSINADO').userName).toBe('Autentique');
    const removedEvent = formHistory.body.find((event) => event.type === 'CLAUSULA_REMOVIDA');
    expect(removedEvent.description).toBe('Cláusula Terceira (Vacina e castração) removida');
    expect(removedEvent.metadata.clauseNumber).toBe(3);
    const approval = formHistory.body.find((event) => event.type === 'STATUS_ALTERADO' && event.toStatus === 'APROVADO');
    expect(approval.metadata.reviewNotes).toBe('Entrevista ok');
    expect(approval.userName).toBe('Usuário ADMIN Contrato');

    // 16. Histórico global com filtros e isolado por organização
    const global = await auth(api().get(`/adoption-history?type=CLAUSULA_REMOVIDA&search=carla&from=${localToday()}&to=${localToday()}`));
    expect(global.status).toBe(200);
    expect(global.body.total).toBe(1);
    expect(global.body.data[0].adoptionFormId).toBe(formId);

    const invalidFilter = await auth(api().get('/adoption-history?from=02/10/2026'));
    expect(invalidFilter.status).toBe(400);

    const otherOrg = await auth(api().get('/adoption-history'), otherAdminToken);
    expect(otherOrg.body.total).toBe(0);
    expect((await auth(api().get(`/adoption-forms/${formId}/history`), otherAdminToken)).status).toBe(404);
    expect((await auth(api().get(`/adoption-forms/${formId}/contract`), otherAdminToken)).status).toBe(404);

    // 17. ADMIN reabre: ficha volta para APROVADO e o pet para EM_PROCESSO
    const reopened = await auth(api().patch(`/adoption-forms/${formId}/status`)).send({ status: 'APROVADO' });
    expect(reopened.status).toBe(200);
    const reopenedRex = await petRepo.findOne({ where: { id: rex.id } });
    expect(reopenedRex.status).toBe('EM_PROCESSO');
    expect(reopenedRex.adoptionDate).toBeNull();
  }, 60000);
});
