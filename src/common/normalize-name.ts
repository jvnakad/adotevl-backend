/**
 * Nome de exibição (o que é gravado em `name`): Unicode NFC, sem espaços nas pontas,
 * qualquer sequência de espaços em branco vira um espaço.
 */
export function normalizeDisplayName(value: string): string {
  return (value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

/**
 * Nome normalizado (o que é gravado em `name_normalized`, usado na unicidade e na busca):
 * nome de exibição, sem acento e em minúsculas. Pontuação é mantida.
 */
export function normalizeName(value: string): string {
  return normalizeDisplayName(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Escapa \, % e _ (nessa ordem) para o termo valer como texto literal num LIKE. */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Termo de busca para LIKE: normalizado e escapado. Vazio depois de normalizar = sem filtro (null). */
export function toLikeTerm(value: string): string | null {
  const term = normalizeName(value);
  return term ? `%${escapeLike(term)}%` : null;
}
