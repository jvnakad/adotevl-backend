import { clauseHeading, numberClauses, REMOVED_CLAUSE_TEXT, StoredClause, toOrdinalPt, toTitleCase } from './contract-numbering';
import { CONTRACT_TEMPLATE } from './contract-template';

const templateClauses = (): StoredClause[] =>
  CONTRACT_TEMPLATE.map((clause, index) => ({ key: clause.key, order: index + 1, content: clause.content, originalContent: clause.content, removed: false }));

const remove = (clauses: StoredClause[], ...keys: string[]) => clauses.map((clause) => (keys.includes(clause.key) ? { ...clause, removed: true } : clause));

describe('toOrdinalPt', () => {
  it.each([
    [1, 'PRIMEIRA'],
    [2, 'SEGUNDA'],
    [3, 'TERCEIRA'],
    [7, 'SÉTIMA'],
    [9, 'NONA'],
    [10, 'DÉCIMA'],
    [11, 'DÉCIMA PRIMEIRA'],
    [12, 'DÉCIMA SEGUNDA'],
    [14, 'DÉCIMA QUARTA'],
    [19, 'DÉCIMA NONA'],
    [20, 'VIGÉSIMA'],
    [21, 'VIGÉSIMA PRIMEIRA'],
    [27, 'VIGÉSIMA SÉTIMA'],
    [30, 'TRIGÉSIMA'],
    [31, 'TRIGÉSIMA PRIMEIRA'],
  ])('%i -> %s', (n, expected) => {
    expect(toOrdinalPt(n)).toBe(expected);
  });

  it('fora da faixa devolve o número', () => {
    expect(toOrdinalPt(0)).toBe('0');
    expect(toOrdinalPt(100)).toBe('100');
  });

  it('título e cabeçalho', () => {
    expect(toTitleCase('DÉCIMA SEGUNDA')).toBe('Décima Segunda');
    expect(clauseHeading(3)).toBe('CLÁUSULA TERCEIRA');
  });
});

describe('numberClauses', () => {
  it('numera as 14 cláusulas do modelo e resolve as referências', () => {
    const { clauses, warnings } = numberClauses(templateClauses());

    expect(clauses).toHaveLength(14);
    expect(clauses[0]).toEqual(expect.objectContaining({ key: 'animal', number: 1, heading: 'CLÁUSULA PRIMEIRA' }));
    expect(clauses[13].heading).toBe('CLÁUSULA DÉCIMA QUARTA');
    expect(clauses.find((c) => c.key === 'obrigacoes_doadora').content).toContain('descrito na Cláusula Primeira à parte ADOTANTE');
    expect(clauses.find((c) => c.key === 'desistencia').content).toContain('previsto na Cláusula Décima Segunda.');
    expect(clauses.some((c) => c.content.includes('{{'))).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('renumera ao remover uma cláusula e a referência acompanha', () => {
    const { clauses } = numberClauses(remove(templateClauses(), 'vacina_castracao'));

    expect(clauses).toHaveLength(13);
    expect(clauses.map((c) => c.key)).not.toContain('vacina_castracao');
    expect(clauses.find((c) => c.key === 'obrigacoes_doadora').heading).toBe('CLÁUSULA TERCEIRA');
    expect(clauses.find((c) => c.key === 'multa').heading).toBe('CLÁUSULA DÉCIMA PRIMEIRA');
    expect(clauses.find((c) => c.key === 'desistencia').content).toContain('previsto na Cláusula Décima Primeira.');
  });

  it('segue a ordem informada, não a do array', () => {
    const clauses = templateClauses();
    clauses.find((c) => c.key === 'foro').order = 0;

    const result = numberClauses(clauses).clauses;

    expect(result[0].key).toBe('foro');
    expect(result[1]).toEqual(expect.objectContaining({ key: 'animal', heading: 'CLÁUSULA SEGUNDA' }));
  });

  it('referência a cláusula removida vira texto fixo e gera aviso', () => {
    const { clauses, warnings } = numberClauses(remove(templateClauses(), 'multa'));

    const desistencia = clauses.find((c) => c.key === 'desistencia');
    expect(desistencia.content).toContain(`previsto na ${REMOVED_CLAUSE_TEXT}.`);
    expect(warnings).toEqual([`A ${desistencia.heading} faz referência a uma cláusula removida.`]);
  });

  it('referência a chave desconhecida também gera aviso', () => {
    const { warnings } = numberClauses([{ key: 'x', order: 1, content: 'Ver {{clausula:nada}}', originalContent: '', removed: false }]);

    expect(warnings).toHaveLength(1);
  });
});
