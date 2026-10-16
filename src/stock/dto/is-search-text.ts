import { registerDecorator, ValidationArguments } from 'class-validator';

const MAX_SEARCH_LENGTH = 150;

/** Busca: texto com até 150 caracteres. Um validador só para devolver uma mensagem só (texto inválido ou tamanho). */
export function IsSearchText() {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isSearchText',
      target: object.constructor,
      propertyName,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && value.length <= MAX_SEARCH_LENGTH,
        defaultMessage: (args: ValidationArguments) =>
          typeof args.value === 'string' ? 'Busca deve ter no máximo 150 caracteres.' : 'Busca deve ser um texto.',
      },
    });
}
