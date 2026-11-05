// Controles (Cc), exceto \n \r \t
const CONTROL_CHARS = /(?![\n\r\t])\p{Cc}/gu;
// Caracteres de formatação invisíveis (Cf) sempre removidos: largura zero (U+200B, U+200C), marcas de direção (U+200E, U+200F),
// bidi (U+202A–U+202E, U+2066–U+2069), BOM (U+FEFF), soft hyphen (U+00AD) e operadores invisíveis (U+2060–U+2064)
const INVISIBLE_CHARS = /[​‌‎‏‪-‮⁦-⁩﻿­⁠-⁤]/gu;
// ZWJ (U+200D) só junta emojis: precisa de um pictograma antes (com U+FE0F ou tom de pele opcionais) e outro depois. Solto, é removido.
const LOOSE_ZWJ = /(?<!\p{Extended_Pictographic}[️\p{Emoji_Modifier}]*)‍|‍(?!\p{Extended_Pictographic})/gu;
// Tags (U+E0000–U+E007F) só existem em bandeira de subdivisão (🏴 + tags); fora disso são removidas
const LOOSE_TAGS = /(?<![\u{1F3F4}\u{E0000}-\u{E007F}])[\u{E0000}-\u{E007F}]/gu;

/**
 * Limpa as observações em silêncio: remove controles e caracteres invisíveis de formatação, mantendo emoji
 * (inclusive ZWJ entre pictogramas, U+FE0F e bandeiras com tags). A limpeza vem antes do limite de tamanho.
 */
export function cleanNotes(value: string): string {
  return value.replace(CONTROL_CHARS, '').replace(INVISIBLE_CHARS, '').replace(LOOSE_ZWJ, '').replace(LOOSE_TAGS, '');
}
