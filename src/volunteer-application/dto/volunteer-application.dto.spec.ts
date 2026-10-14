import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VolunteerApplicationDto } from './volunteer-application.dto';

const valid = {
  city: 'Curitiba',
  neighborhood: 'Boqueirão',
  referralSources: ['INSTAGRAM'],
  interestAreas: ['EVENTOS'],
  aboutYou: 'Gosto de bicho.',
  strengthWeakness: 'Teimosa e dedicada.',
  unpaidWorkFeeling: 'Tranquila.',
  strayAnimalsFeeling: 'QUERO_MUDAR',
  loyalty: 'SIM',
  witnessedAbuse: false,
  pressureHandling: 'CONSIGO',
  stressReaction: 'PACIFICA',
  roadkillActions: ['VAI_AO_LOCAL'],
  emergencyRescueHelp: 'Divulgo.',
  debtActions: ['RIFA'],
  availablePeriods: ['NOITE'],
  tools: ['CANVA'],
  shelterVisit: 'SIM',
  acceptsInterview: true,
};

const errorsOf = async (data: object) => {
  const errors = await validate(plainToInstance(VolunteerApplicationDto, data));
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
};

describe('VolunteerApplicationDto', () => {
  it('questionário completo é válido', async () => {
    expect(await errorsOf(valid)).toEqual([]);
  });

  it('"Outros" exige o texto, em como conheceu e nos setores', async () => {
    expect(await errorsOf({ ...valid, referralSources: ['OUTROS'] })).toContain('Conte como conheceu a Adote (Outros).');
    expect(await errorsOf({ ...valid, interestAreas: ['EVENTOS', 'OUTROS'] })).toContain('Informe qual outro setor interessa a você.');
    expect(await errorsOf({ ...valid, interestAreas: ['OUTROS'], interestOther: 'Lar temporário' })).toEqual([]);
  });

  it('"Nenhum" e as opções de recusa não vão junto com outras', async () => {
    expect(await errorsOf({ ...valid, tools: ['NENHUM', 'CANVA'] })).toContain('"Nenhum" não pode ser marcada junto com outras opções.');
    expect(await errorsOf({ ...valid, roadkillActions: ['PREFERE_NAO_VER', 'VAI_AO_LOCAL'] })).toHaveLength(1);
    expect(await errorsOf({ ...valid, debtActions: ['PREFERE_NAO_PARTICIPAR', 'RIFA'] })).toHaveLength(1);
    expect(await errorsOf({ ...valid, tools: ['NENHUM'] })).toEqual([]);
  });

  it('múltipla escolha vazia ou opção fora da lista é recusada', async () => {
    expect(await errorsOf({ ...valid, availablePeriods: [] })).toContain('Responda: horários mais livres.');
    expect(await errorsOf({ ...valid, tools: ['PHOTOSHOP'] })).toContain('Opção inválida em "Ferramentas".');
  });
});
