// Numeração das cláusulas por extenso (CLÁUSULA PRIMEIRA, SEGUNDA...) e resolução das referências cruzadas.
// O front replica esta lógica em src/mappers/adoptionContract.ts — mudou aqui, mudar lá.

export interface StoredClause {
  key: string;
  order: number;
  content: string;
  originalContent: string;
  removed: boolean;
}

export interface NumberedClause {
  key: string;
  number: number;
  heading: string;
  content: string;
}

const UNITS = ['', 'PRIMEIRA', 'SEGUNDA', 'TERCEIRA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÉTIMA', 'OITAVA', 'NONA'];
const TENS = ['', 'DÉCIMA', 'VIGÉSIMA', 'TRIGÉSIMA', 'QUADRAGÉSIMA', 'QUINQUAGÉSIMA', 'SEXAGÉSIMA', 'SEPTUAGÉSIMA', 'OCTOGÉSIMA', 'NONAGÉSIMA'];

export const CLAUSE_TOKEN = /\{\{clausula:([a-z0-9_]+)\}\}/g;
export const REMOVED_CLAUSE_TEXT = '[cláusula removida]';

// Ordinal feminino por extenso em maiúsculas (1..99): 12 -> "DÉCIMA SEGUNDA"
export function toOrdinalPt(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(n);
  const tens = TENS[Math.floor(n / 10)];
  const units = UNITS[n % 10];
  return [tens, units].filter(Boolean).join(' ');
}

// "DÉCIMA SEGUNDA" -> "Décima Segunda"
export function toTitleCase(text: string): string {
  return text
    .toLocaleLowerCase('pt-BR')
    .split(' ')
    .map((word) => word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1))
    .join(' ');
}

export function clauseHeading(n: number) {
  return `CLÁUSULA ${toOrdinalPt(n)}`;
}

// Ignora as removidas, numera pela ordem e troca os tokens pelo número atual da cláusula referenciada
export function numberClauses(clauses: StoredClause[]): { clauses: NumberedClause[]; warnings: string[] } {
  const active = clauses.filter((clause) => !clause.removed).sort((a, b) => a.order - b.order);
  const numbers = new Map(active.map((clause, index) => [clause.key, index + 1]));
  const warnings: string[] = [];

  const numbered = active.map((clause, index) => {
    const number = index + 1;
    const heading = clauseHeading(number);
    const content = (clause.content ?? '').replace(CLAUSE_TOKEN, (_token, key: string) => {
      const target = numbers.get(key);
      if (target) return `Cláusula ${toTitleCase(toOrdinalPt(target))}`;
      warnings.push(`A ${heading} faz referência a uma cláusula removida.`);
      return REMOVED_CLAUSE_TEXT;
    });
    return { key: clause.key, number, heading, content };
  });

  return { clauses: numbered, warnings };
}
