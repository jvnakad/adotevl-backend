import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePetDto } from './create-pet.dto';
import { UpdatePetDto } from './update-pet.dto';

const pet = (overrides: Record<string, unknown> = {}) => ({
  name: 'Bob',
  species: 'Gato',
  animal: 'Persa',
  sex: 'Macho',
  birthDate: '2024-07',
  organizationId: 'a0000000-0000-4000-8000-000000000001',
  ...overrides,
});

const errorsOf = async (cls: typeof CreatePetDto | typeof UpdatePetDto, body: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(cls, body));
  return Object.fromEntries(errors.map((e) => [e.property, Object.values(e.constraints ?? {})]));
};

beforeAll(() => jest.useFakeTimers({ now: new Date('2026-10-14T12:00:00Z') }));
afterAll(() => jest.useRealTimers());

describe('nascimento (create e update)', () => {
  it.each([CreatePetDto, UpdatePetDto])('%p exige o mês/ano de nascimento', async (cls) => {
    const errors = await errorsOf(cls, pet({ birthDate: undefined }));

    expect(errors.birthDate).toEqual(['Informe o mês/ano de nascimento.']);
  });

  it.each(['07/2024', '2024-13', '2024-7', '2024-07-01'])('rejeita formato %s', async (birthDate) => {
    const errors = await errorsOf(CreatePetDto, pet({ birthDate }));

    expect(errors.birthDate).toEqual(['Nascimento deve estar no formato AAAA-MM.']);
  });

  it('rejeita mês futuro (mês atual é aceito)', async () => {
    expect((await errorsOf(CreatePetDto, pet({ birthDate: '2026-11' }))).birthDate).toEqual(['Nascimento não pode ser no futuro.']);
    expect(await errorsOf(CreatePetDto, pet({ birthDate: '2026-10' }))).toEqual({});
  });
});

describe('CreatePetDto', () => {
  it('aceita espécie e raça do catálogo', async () => {
    expect(await errorsOf(CreatePetDto, pet())).toEqual({});
  });

  it('aceita pet sem raça', async () => {
    expect(await errorsOf(CreatePetDto, pet({ animal: undefined }))).toEqual({});
  });

  it('rejeita espécie fora do catálogo', async () => {
    const errors = await errorsOf(CreatePetDto, pet({ species: 'Dragão', animal: undefined }));

    expect(errors.species).toEqual(['Espécie inválida.']);
  });

  it('rejeita raça de outra espécie', async () => {
    const errors = await errorsOf(CreatePetDto, pet({ species: 'Cachorro', animal: 'Persa' }));

    expect(errors.animal).toEqual(['Raça inválida para a espécie Cachorro.']);
  });
});

describe('UpdatePetDto', () => {
  it('aceita atualização sem espécie nem raça', async () => {
    expect(await errorsOf(UpdatePetDto, { name: 'Rex', birthDate: '2024-07' })).toEqual({});
  });

  it('aceita troca de espécie e raça compatíveis', async () => {
    expect(await errorsOf(UpdatePetDto, { species: 'Cachorro', animal: 'Labrador', birthDate: '2024-07' })).toEqual({});
  });

  it('rejeita espécie fora do catálogo', async () => {
    const errors = await errorsOf(UpdatePetDto, { species: 'Dragão' });

    expect(errors.species).toEqual(['Espécie inválida.']);
  });

  it('rejeita raça de outra espécie', async () => {
    const errors = await errorsOf(UpdatePetDto, { species: 'Gato', animal: 'Labrador' });

    expect(errors.animal).toEqual(['Raça inválida para a espécie Gato.']);
  });

  it('exige a espécie junto com a raça', async () => {
    const errors = await errorsOf(UpdatePetDto, { animal: 'Persa' });

    expect(errors.animal).toEqual(['Informe a espécie junto com a raça.']);
  });
});
