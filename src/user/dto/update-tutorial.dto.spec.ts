import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTutorialDto } from './update-tutorial.dto';

const errorsOf = async (plain: object) => {
  const errors = await validate(plainToInstance(UpdateTutorialDto, plain));
  return errors.map((error) => error.property);
};

describe('UpdateTutorialDto', () => {
  it('aceita tour com versão', async () => {
    expect(await errorsOf({ tour: 'PETS_MEDICAL_RECORDS', version: 1 })).toEqual([]);
  });

  it('aceita só o desligamento', async () => {
    expect(await errorsOf({ disabled: true })).toEqual([]);
  });

  it('exige versão quando há tour', async () => {
    expect(await errorsOf({ tour: 'PETS' })).toEqual(['version']);
  });

  it('recusa chave de tour fora do padrão', async () => {
    expect(await errorsOf({ tour: 'pets; drop', version: 1 })).toEqual(['tour']);
  });

  it('recusa versão menor que 1', async () => {
    expect(await errorsOf({ tour: 'PETS', version: 0 })).toEqual(['version']);
  });
});
