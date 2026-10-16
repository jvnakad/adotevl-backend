import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

const MAX_NAME_LENGTH = 250;

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
        validate: (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME_LENGTH,
        defaultMessage: (args: ValidationArguments) => {
          const value = args.value;
          return typeof value === 'string' && value.length > MAX_NAME_LENGTH ? 'O nome pode ter até 250 caracteres.' : requiredMessage;
        },
      },
    });
}
