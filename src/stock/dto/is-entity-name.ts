import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

const MAX_NAME_LENGTH = 250;
// Caracteres de controle (Cc) e de formatação (Cf, inclui os bidi U+202A–U+202E e U+2066–U+2069 e os de largura zero). Emoji é permitido.
const INVALID_NAME_CHARS = /[\p{Cc}\p{Cf}]/u;
export const INVALID_NAME_MESSAGE = 'O nome contém caracteres inválidos.';

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
        validate: (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME_LENGTH && !INVALID_NAME_CHARS.test(value),
        defaultMessage: (args: ValidationArguments) => {
          const value = args.value;
          if (typeof value !== 'string' || value.length === 0) return requiredMessage;
          if (value.length > MAX_NAME_LENGTH) return 'O nome pode ter até 250 caracteres.';
          return INVALID_NAME_MESSAGE;
        },
      },
    });
}
