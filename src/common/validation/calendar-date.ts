import { registerDecorator, ValidationOptions } from 'class-validator';
import { todayInBrazil } from '../../volunteer-schedule/schedule-time';

/** Data AAAA-MM-DD que existe no calendário (recusa 2026-02-30 e 2026-11-31). */
export function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function IsCalendarDate(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName,
      options: { message: 'Informe uma data que exista no calendário.', ...options },
      validator: { validate: (value: unknown) => isCalendarDate(value) },
    });
}

/** Data AAAA-MM-DD que não é posterior a hoje (fuso de Brasília). Formato inválido é problema de outro validador. */
export function IsNotFutureDate(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isNotFutureDate',
      target: object.constructor,
      propertyName,
      options: { message: 'A data não pode ser no futuro.', ...options },
      validator: { validate: (value: unknown) => typeof value !== 'string' || value.slice(0, 10) <= todayInBrazil() },
    });
}

/** Valor em reais: positivo, no máximo 2 casas e dentro de numeric(10,2). */
export const MONEY_MAX = 99_999_999.99;
