import { currentMonthInBrazil, petAgeLabel, petBirthWithAge } from './pet-age';

// Referência: outubro/2026
const now = '2026-10';

describe('petAgeLabel', () => {
  it.each([
    ['2024-07', '2 anos e 3 meses'],
    ['2025-09', '1 ano e 1 mês'],
    ['2024-10', '2 anos'],
    ['2025-10', '1 ano'],
    ['2026-02', '8 meses'],
    ['2026-09', '1 mês'],
    ['2026-10', 'menos de 1 mês'],
  ])('nascido em %s tem %s', (birthDate, expected) => {
    expect(petAgeLabel(birthDate, now)).toBe(expected);
  });

  it('sem data não tem idade', () => {
    expect(petAgeLabel(null, now)).toBeNull();
  });
});

describe('petBirthWithAge', () => {
  it('formata mês/ano com a idade entre parênteses', () => {
    expect(petBirthWithAge('2024-07', now)).toBe('07/2024 (2 anos e 3 meses)');
  });

  it('sem data devolve vazio', () => {
    expect(petBirthWithAge(null, now)).toBe('');
  });
});

describe('currentMonthInBrazil', () => {
  it('usa o mês de Brasília (UTC-3), não o UTC', () => {
    // 1º de novembro 01:00 UTC ainda é 31 de outubro em Brasília
    expect(currentMonthInBrazil(new Date('2026-11-01T01:00:00Z'))).toBe('2026-10');
  });
});
