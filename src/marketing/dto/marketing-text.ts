import { Transform } from 'class-transformer';
import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { normalizeDisplayName, normalizeName } from '../../common/normalize-name';
import { cleanNotes } from '../../stock/dto/clean-notes';

// Controles (Cc) e formatação invisível (Cf) não entram em nomes e títulos; emoji é permitido (posts de redes sociais)
const INVALID_CHARS = /[\p{Cc}\p{Cf}]/u;

/** Espaços das pontas removidos e repetidos reduzidos antes de validar o tamanho. */
export const trimText = ({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeDisplayName(value) : value);

/** Cor aceita em hex de 3 ou 6 dígitos, maiúscula ou minúscula, e é gravada em maiúsculas (#RRGGBB). */
export const upperColor = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const hex = value.trim().toUpperCase();
  // #RGB vira #RRGGBB
  return /^#[0-9A-F]{3}$/.test(hex) ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex;
};
export const COLOR_PATTERN = /^#[0-9A-F]{6}$/;
export const COLOR_MESSAGE = 'Cor inválida. Use o formato #RGB ou #RRGGBB.';

/** Texto livre (descrição, comentário): limpa invisíveis, apara as pontas; vazio vira null. */
export const cleanFreeText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const cleaned = cleanNotes(value).trim();
  return cleaned === '' ? null : cleaned;
};

/**
 * Nome curto (fila, etiqueta, título de card ou subtarefa): obrigatório, até `max` caracteres, sem controles e com ao menos
 * uma letra depois de normalizado (o banco exige name_normalized não vazio). Uma mensagem só por falha.
 */
export function IsMarketingName(max: number, requiredMessage: string, options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    Transform(trimText)(object, propertyName);
    registerDecorator({
      name: 'isMarketingName',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && value.length > 0 && value.length <= max && !INVALID_CHARS.test(value) && normalizeName(value).length > 0,
        defaultMessage: (args: ValidationArguments) => {
          const value = args.value;
          if (typeof value !== 'string' || value.length === 0 || normalizeName(value).length === 0) return requiredMessage;
          if (value.length > max) return `Use até ${max} caracteres.`;
          return 'O texto contém caracteres inválidos.';
        },
      },
    });
  };
}

/** Texto obrigatório de até `max` caracteres (já limpo por cleanFreeText: vazio vira null). Uma mensagem só por falha. */
export function IsRequiredText(max: number, requiredMessage: string, tooLongMessage: string) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isRequiredText',
      target: object.constructor,
      propertyName,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= max,
        defaultMessage: (args: ValidationArguments) => (typeof args.value === 'string' && args.value.length > max ? tooLongMessage : requiredMessage),
      },
    });
}

/** UUID ou null (ex.: remover capa, limpar responsável). */
export function IsUuidOrNull(message: string) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isUuidOrNull',
      target: object.constructor,
      propertyName,
      options: { message },
      validator: { validate: (value: unknown) => value === null || (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) },
    });
}
