import { registerDecorator, ValidationOptions } from 'class-validator';

// Controles (Cc) exceto quebra de linha (\n, \r) e tabulação (\t)
const isForbidden = (text: string) => [...text].some((char) => /\p{Cc}/u.test(char) && char !== '\n' && char !== '\r' && char !== '\t');

/** Texto livre sem caracteres de controle, exceto \n, \r e \t (observações). Não texto passa: quem valida o tipo é o @IsString. */
export function HasNoControlChars(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'hasNoControlChars',
      target: object.constructor,
      propertyName,
      options,
      validator: { validate: (value: unknown) => typeof value !== 'string' || !isForbidden(value) },
    });
}
