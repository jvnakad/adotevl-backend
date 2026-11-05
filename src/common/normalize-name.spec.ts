import { normalizeDisplayName, normalizeName, toLikeTerm } from './normalize-name';

describe('normalize-name', () => {
  // Vetores do doc de banco (docs/db/estoque.md, seção 7); os mesmos valem no front
  const vectors: [string, string, string][] = [
    ['  Produto   de  limpeza  ', 'Produto de limpeza', 'produto de limpeza'],
    ['Ração', 'Ração', 'racao'],
    ['RAÇÃO', 'RAÇÃO', 'racao'],
    [' Racão ', 'Racão', 'racao'],
    ['Ração', 'Ração', 'racao'], // decomposto (c + cedilha, a + til)
    ['racao  premium', 'racao premium', 'racao premium'],
    ['\tÁgua\nSanitária', 'Água Sanitária', 'agua sanitaria'],
    ['Ação Pet', 'Ação Pet', 'acao pet'],
    ['Pão-de-Açúcar', 'Pão-de-Açúcar', 'pao-de-acucar'],
    ['Ñandú', 'Ñandú', 'nandu'],
    ['   ', '', ''],
  ];

  it.each(vectors)('normaliza %j', (input, display, normalized) => {
    expect(normalizeDisplayName(input)).toBe(display);
    expect(normalizeName(input)).toBe(normalized);
  });

  it('pontuação diferencia nomes', () => {
    expect(normalizeName('Pão de Açúcar')).not.toBe(normalizeName('Pão-de-Açúcar'));
    expect(normalizeName('pao de  acucar')).toBe(normalizeName('Pão de Açúcar'));
  });

  it('lida com null e undefined', () => {
    expect(normalizeDisplayName(undefined)).toBe('');
    expect(normalizeName(null)).toBe('');
  });

  describe('toLikeTerm', () => {
    it('normaliza e envolve com %', () => expect(toLikeTerm(' RAÇÃO ')).toBe('%racao%'));
    it('escapa barra, % e _', () => expect(toLikeTerm('a_b%c\\d')).toBe('%a\\_b\\%c\\\\d%'));
    it('termo vazio = sem filtro', () => expect(toLikeTerm('   ')).toBeNull());
  });
});
