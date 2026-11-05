import { ageFromBirthDate, dateOnly, sanitizeContractData, emptyContractData, speciesFromPet, sexFromPet, prefillAnimalFromPet } from './contract-data';

describe('contract-data', () => {
  describe('prefillAnimalFromPet', () => {
    beforeAll(() => jest.useFakeTimers({ now: new Date('2026-10-14T12:00:00Z') }));
    afterAll(() => jest.useRealTimers());

    it('preenche a idade do animal com mês/ano de nascimento e idade calculada', () => {
      const data = prefillAnimalFromPet(emptyContractData(), { name: 'Rex', species: 'Cachorro', birthDate: '2024-07' } as any);

      expect(data.animal.age).toBe('07/2024 (2 anos e 3 meses)');
    });

    it('pet sem nascimento deixa a idade em branco', () => {
      const data = prefillAnimalFromPet(emptyContractData(), { name: 'Rex', species: 'Cachorro', birthDate: null } as any);

      expect(data.animal.age).toBe('');
    });
  });

  it('dateOnly trata meia-noite local (driver pg) e meia-noite UTC', () => {
    expect(dateOnly(new Date(1992, 2, 15))).toBe('1992-03-15');
    expect(dateOnly(new Date('1992-03-15'))).toBe('1992-03-15');
    expect(dateOnly('1992-03-15')).toBe('1992-03-15');
    expect(dateOnly(null)).toBe('');
  });

  it('calcula a idade considerando aniversário', () => {
    const today = new Date(2026, 9, 2);
    expect(ageFromBirthDate('1990-10-02', today)).toBe('36 anos');
    expect(ageFromBirthDate('1990-10-03', today)).toBe('35 anos');
    expect(ageFromBirthDate('2025-10-01', today)).toBe('1 ano');
    expect(ageFromBirthDate('', today)).toBe('');
  });

  it('mapeia espécie e sexo do cadastro de pets', () => {
    expect(speciesFromPet({ species: 'Cachorro' } as any)).toBe('CANINA');
    expect(speciesFromPet({ species: 'Gato' } as any)).toBe('FELINA');
    expect(speciesFromPet({ species: 'Cavalo' } as any)).toBe('');
    expect(sexFromPet({ sex: 'Femea' } as any)).toBe('FEMEA');
    expect(sexFromPet({ sex: 'Macho' } as any)).toBe('MACHO');
  });

  it('data vazia da assinatura vira null e cidade vazia volta ao padrão', () => {
    const { data, errors } = sanitizeContractData({ signature: { city: ' ', date: '' } }, emptyContractData());

    expect(errors).toEqual([]);
    expect(data.signature).toEqual({ city: 'Curitiba/PR', date: null });
  });
});
