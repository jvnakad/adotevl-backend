// Regras de horário da agenda de voluntariado (fuso de Brasília, sem horário de verão desde 2019).

/** Funcionamento do abrigo: seg a sex 08:00–16:00; sáb e dom 13:00–16:00 */
export const SCHEDULE_WEEKDAY_HOURS = { open: '08:00', close: '16:00' } as const;
export const SCHEDULE_WEEKEND_HOURS = { open: '13:00', close: '16:00' } as const;
export const MAX_DAYS_AHEAD = 60;
export const CANCEL_MIN_HOURS = 24;

/** 'HH:MM' em passos de 30 min */
export const TIME_PATTERN = /^([01]\d|2[0-3]):(00|30)$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const todayInBrazil = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** Soma dias a 'YYYY-MM-DD' (meio-dia UTC: sem risco de virar o dia) */
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Instante em que o turno começa (horário de Brasília) */
export const startsAt = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);

/** Sábado ou domingo ('YYYY-MM-DD', meio-dia UTC: sem risco de virar o dia) */
export function isWeekend(date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** Horário de funcionamento do dia */
export const scheduleHoursFor = (date: string) => (isWeekend(date) ? SCHEDULE_WEEKEND_HOURS : SCHEDULE_WEEKDAY_HOURS);

/** Primeiro e último dia de 'YYYY-MM' */
export function monthRange(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/** '2026-10-06' -> '06/10/2026' */
export const formatDateBR = (date: string) => date.split('-').reverse().join('/');

/** Coluna `date` do Postgres: o driver devolve Date à meia-noite local; aqui fica sempre 'YYYY-MM-DD'. */
export const dateColumnTransformer = {
  to: (value: string) => value,
  from: (value: string | Date | null) => {
    if (!value || typeof value === 'string') return value;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  },
};

/** 'HH:MM' atual em Brasília */
export const timeInBrazil = (now = new Date()) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);

/**
 * Primeiro início possível hoje: o próximo passo de 30 min estritamente depois de agora (10:07 -> 10:30; 10:30 -> 11:00),
 * nunca antes da abertura. `null` quando não sobra horário (o início precisa ser antes do fechamento).
 */
export function earliestStartToday(now = new Date()): string | null {
  const [hours, minutes] = timeInBrazil(now).split(':').map(Number);
  const nextSlot = (Math.floor((hours * 60 + minutes) / 30) + 1) * 30;
  const { open, close } = scheduleHoursFor(todayInBrazil(now));
  const pad = (n: number) => String(n).padStart(2, '0');
  const candidate = `${pad(Math.floor(nextSlot / 60))}:${pad(nextSlot % 60)}`;
  const earliest = candidate < open ? open : candidate;
  return nextSlot >= 24 * 60 || earliest >= close ? null : earliest;
}
