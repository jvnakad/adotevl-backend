import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

const MAX_NAME_LENGTH = 250;
// Emoji não é permitido em nomes: pictogramas, modificadores de tom de pele, bandeiras (indicadores regionais),
// seletor de emoji U+FE0F, keycap U+20E3 e tags U+E0020–E007F. Dígitos, # e * continuam permitidos.
const EMOJI_CHARS = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0F\u20E3\u{E0020}-\u{E007F}]/u;
// Demais caracteres de controle (Cc) e de formatação (Cf: bidi U+202A–U+202E e U+2066–U+2069, largura zero, ZWJ solto etc.)
const INVALID_NAME_CHARS = /[\p{Cc}\p{Cf}]/u;
export const INVALID_NAME_MESSAGE = 'O nome contém caracteres inválidos.';
export const EMOJI_NAME_MESSAGE = 'O nome não pode conter emojis.';
const hasInvalidChars = (value: string) => EMOJI_CHARS.test(value) || INVALID_NAME_CHARS.test(value);

/**
 * Nome de produto/tipo: texto não vazio com até 250 caracteres (já normalizado pelo Transform).
 * Um validador só, para uma falha devolver uma mensagem só: obrigatório ou tamanho, nunca as duas nem repetida.
 */
export function IsEntityName(requiredMessage: string, options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isEntityName',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME_LENGTH && !hasInvalidChars(value),
        defaultMessage: (args: ValidationArguments) => {
          const value = args.value;
          if (typeof value !== 'string' || value.length === 0) return requiredMessage;
          if (value.length > MAX_NAME_LENGTH) return 'O nome pode ter até 250 caracteres.';
          return EMOJI_CHARS.test(value) ? EMOJI_NAME_MESSAGE : INVALID_NAME_MESSAGE;
        },
      },
    });
}
