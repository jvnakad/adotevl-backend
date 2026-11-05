import { BadRequestException } from '@nestjs/common';
import { registerDecorator, ValidationOptions } from 'class-validator';

// Filtros de período são por dia local do Brasil (sem horário de verão desde 2019)
const LOCAL_UTC_OFFSET = '-03:00';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' existente no calendário (recusa 2026-02-31). */
export function isValidIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Decorator: data 'YYYY-MM-DD' real do calendário (opcional pelo @IsOptional do campo). */
export function IsIsoDate(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isIsoDate',
      target: object.constructor,
      propertyName,
      options,
      validator: { validate: (value: unknown) => isValidIsoDate(value) },
    });
}

/** Meia-noite local (Brasília) do dia, mais `plusDays`. */
function startOfLocalDay(date: string, plusDays = 0) {
  const start = new Date(`${date}T00:00:00${LOCAL_UTC_OFFSET}`);
  start.setUTCDate(start.getUTCDate() + plusDays);
  return start;
}

/** Período [from, to] em dias locais, inclusivo nas duas pontas: `createdAt >= start` e `createdAt < endExclusive`. */
export function localPeriod(from?: string, to?: string) {
  if (from && to && from > to) throw new BadRequestException('A data inicial não pode ser maior que a final.');
  return {
    start: from ? startOfLocalDay(from) : null,
    endExclusive: to ? startOfLocalDay(to, 1) : null,
  };
}
