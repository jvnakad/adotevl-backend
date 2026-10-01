import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAdoptionFormDto } from './create-adoption-form.dto';
import { UpdateAdoptionFormDto } from './update-adoption-form.dto';
import { UpdateAdoptionFormStatusDto } from './update-adoption-form-status.dto';

// Payload multipart como o front envia: tudo string, condicionais escondidas vazias
const multipart = (overrides: Record<string, string> = {}): Record<string, string> => ({
  fullName: ' Maria da Silva ',
  email: 'maria@teste.com',
  birthDate: '1990-05-10',
  cpf: '52998224725',
  phone: '11987654321',
  phoneIsWhatsapp: 'true',
  occupation: 'Designer',
  zipCode: '01310100',
  street: 'Av Paulista',
  number: '1000',
  complement: '',
  neighborhood: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
  hasPets: 'no',
  petsCount: '0',
  petsDescription: '',
  petsNeutered: '',
  petsNotNeuteredReason: '',
  knowsNeuteringImportance: 'yes',
  petsVaccinesUpToDate: 'no_pets',
  catFivFelvTested: 'no_cat',
  awareOfAdaptationPeriod: 'yes',
  desiredAnimal: 'Gato',
  sawAdOn: 'instagram',
  sawAdOnOther: '',
  canAffordCare: 'yes',
  intendedFood: 'Premium',
  hasTrustedClinic: 'no',
  trustedClinicName: '',
  residenceType: 'house',
  condoPetPolicy: '',
  windowsScreened: 'not_adopting_cat',
  housingOwnership: 'owned',
  housingOwnershipOther: '',
  adultsCount: '2',
  childrenCount: '0',
  childrenAges: '',
  everyoneAgrees: 'yes',
  disagreementPlan: 'Conversar',
  hoursAlonePerDay: '4',
  caretakerWhenTraveling: 'Mãe',
  pregnancyOpinion: 'Fica',
  plansToMove: 'no',
  moveAnimalPlan: '',
  someoneAllergic: 'no',
  allergyPlan: 'Tratar',
  hasSurrenderedPet: 'no',
  surrenderDetails: '',
  hasLostPetOutside: 'no',
  lostPetDetails: '',
  hadRecentPetDeath: 'no',
  recentDeathDetails: '',
  awareOfLongevity: 'yes',
  willReportChanges: 'yes',
  willNotRehomeWithoutNotice: 'yes',
  idealAnimal: 'Calmo',
  thinkingSince: '1 ano',
  awareOfEvaluationProcess: 'yes',
  agreesWithTerms: 'agree',
  declaresTruthful: 'yes',
  organizationId: 'a0000000-0000-4000-8000-000000000001',
  ...overrides,
});

const check = async <T extends object>(cls: new () => T, payload: object) => {
  const instance = plainToInstance(cls, payload);
  const errors = await validate(instance, { whitelist: true });
  return { instance, errors, fields: errors.map((e) => e.property) };
};

describe('CreateAdoptionFormDto', () => {
  it('aceita a ficha do front e converte tipos', async () => {
    const { instance, errors } = await check(CreateAdoptionFormDto, multipart());

    expect(errors).toEqual([]);
    expect(instance.fullName).toBe('Maria da Silva');
    expect(instance.phoneIsWhatsapp).toBe(true);
    expect(instance.adultsCount).toBe(2);
    expect(instance.hoursAlonePerDay).toBe(4);
    expect(instance.complement).toBeUndefined();
    expect(instance.sawAdOnOther).toBeUndefined();
  });

  it.each([
    ['cpf', '123.456.789-09'],
    ['phone', '119'],
    ['zipCode', '0131010'],
    ['state', 'São Paulo'],
    ['email', 'maria'],
    ['birthDate', '10/05/1990'],
    ['organizationId', 'org-1'],
    ['phoneIsWhatsapp', 'sim'],
  ])('rejeita %s mal formatado', async (field, value) => {
    const { fields } = await check(CreateAdoptionFormDto, multipart({ [field]: value }));

    expect(fields).toContain(field);
  });

  it.each([
    ['hasPets', 'talvez'],
    ['residenceType', 'castle'],
    ['windowsScreened', 'sim'],
    ['sawAdOn', 'jornal'],
    ['someoneAllergic', 'maybe'],
    ['knowsNeuteringImportance', 'unknown'],
  ])('rejeita opção inválida em %s', async (field, value) => {
    const { fields } = await check(CreateAdoptionFormDto, multipart({ [field]: value }));

    expect(fields).toEqual([field]);
  });

  it('exige respostas obrigatórias', async () => {
    const { fields } = await check(CreateAdoptionFormDto, multipart({ fullName: '  ', desiredAnimal: '', allergyPlan: '' }));

    expect(fields).toEqual(expect.arrayContaining(['fullName', 'desiredAnimal', 'allergyPlan']));
  });

  it('valida números: adultos >= 1, crianças >= 0, horas entre 0 e 24', async () => {
    const { fields } = await check(CreateAdoptionFormDto, multipart({ adultsCount: '0', childrenCount: '-1', hoursAlonePerDay: '25' }));

    expect(fields).toEqual(expect.arrayContaining(['adultsCount', 'childrenCount', 'hoursAlonePerDay']));
  });

  it('exige concordar com os termos e declarar veracidade', async () => {
    const { fields } = await check(CreateAdoptionFormDto, multipart({ agreesWithTerms: 'disagree', declaresTruthful: 'no' }));

    expect(fields).toEqual(['agreesWithTerms', 'declaresTruthful']);
  });

  it.each([
    ['hasPets = yes', { hasPets: 'yes', petsCount: '2', petsNeutered: 'yes' }, 'petsDescription'],
    ['petsNeutered = no', { hasPets: 'yes', petsCount: '1', petsDescription: 'Gato', petsNeutered: 'no' }, 'petsNotNeuteredReason'],
    ['sawAdOn = other', { sawAdOn: 'other' }, 'sawAdOnOther'],
    ['hasTrustedClinic = yes', { hasTrustedClinic: 'yes' }, 'trustedClinicName'],
    ['residenceType = apartment', { residenceType: 'apartment' }, 'condoPetPolicy'],
    ['housingOwnership = other', { housingOwnership: 'other' }, 'housingOwnershipOther'],
    ['childrenCount > 0', { childrenCount: '1' }, 'childrenAges'],
    ['plansToMove = yes', { plansToMove: 'yes' }, 'moveAnimalPlan'],
    ['hasSurrenderedPet = yes', { hasSurrenderedPet: 'yes' }, 'surrenderDetails'],
    ['hasLostPetOutside = yes', { hasLostPetOutside: 'yes' }, 'lostPetDetails'],
    ['hadRecentPetDeath = yes', { hadRecentPetDeath: 'yes' }, 'recentDeathDetails'],
  ])('exige complemento quando %s', async (_label, overrides, field) => {
    const { fields } = await check(CreateAdoptionFormDto, multipart(overrides));

    expect(fields).toEqual([field]);
  });

  it('limita o tamanho dos textos', async () => {
    const { fields } = await check(CreateAdoptionFormDto, multipart({ desiredAnimal: 'a'.repeat(2001) }));

    expect(fields).toEqual(['desiredAnimal']);
  });
});

describe('UpdateAdoptionFormDto', () => {
  it('aceita edição parcial', async () => {
    const { errors } = await check(UpdateAdoptionFormDto, { occupation: 'Engenheira' });

    expect(errors).toEqual([]);
  });

  it('continua validando os campos enviados', async () => {
    const { fields } = await check(UpdateAdoptionFormDto, { cpf: '123', residenceType: 'castle' });

    expect(fields).toEqual(expect.arrayContaining(['cpf', 'residenceType']));
  });

  it('não permite trocar organização nem termos aceitos', async () => {
    const instance = plainToInstance(UpdateAdoptionFormDto, { organizationId: 'x', agreesWithTerms: 'disagree' });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.map((e) => e.property).sort()).toEqual(['agreesWithTerms', 'organizationId']);
  });
});

describe('UpdateAdoptionFormStatusDto', () => {
  it('aceita status válido com observações opcionais', async () => {
    expect((await check(UpdateAdoptionFormStatusDto, { status: 'APROVADO' })).errors).toEqual([]);
    expect((await check(UpdateAdoptionFormStatusDto, { status: 'REPROVADO', reviewNotes: 'Sem tela' })).errors).toEqual([]);
  });

  it('rejeita status desconhecido', async () => {
    const { fields } = await check(UpdateAdoptionFormStatusDto, { status: 'QUALQUER' });

    expect(fields).toEqual(['status']);
  });
});
