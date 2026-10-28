import { BadRequestException } from '@nestjs/common';

export const MIN_VOLUNTEER_AGE = 16;
export const ADULT_AGE = 18;
export const MAX_VOLUNTEER_AGE = 100;

const todayInBrazil = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** Idade em anos completos na data de hoje em Brasília (`birthDate` = 'YYYY-MM-DD'). */
export function ageInYears(birthDate: string, now = new Date()) {
  const [year, month, day] = birthDate.slice(0, 10).split('-').map(Number);
  const [todayYear, todayMonth, todayDay] = todayInBrazil(now).split('-').map(Number);
  const hadBirthday = todayMonth > month || (todayMonth === month && todayDay >= day);
  return todayYear - year - (hadBirthday ? 0 : 1);
}

type GuardianInput = { birthDate: string; guardianName?: string; guardianPhone?: string; guardianConsent?: boolean };

/**
 * Voluntário a partir de 16 anos; menor de 18 precisa de nome e celular do responsável e do aceite dele.
 * Devolve as colunas do responsável (null para maior de idade, mesmo se enviadas).
 */
export function guardianFields({ birthDate, guardianName, guardianPhone, guardianConsent }: GuardianInput) {
  const age = ageInYears(birthDate);
  if (age > MAX_VOLUNTEER_AGE) throw new BadRequestException('Informe uma data de nascimento válida.');
  if (age < MIN_VOLUNTEER_AGE) throw new BadRequestException(`É necessário ter pelo menos ${MIN_VOLUNTEER_AGE} anos.`);
  if (age >= ADULT_AGE) return { guardianName: null, guardianPhone: null, guardianConsentAt: null };
  if (!guardianName?.trim() || !guardianPhone || guardianConsent !== true) {
    throw new BadRequestException('Menor de 18 anos: informe nome e celular do responsável e confirme que ele está ciente.');
  }
  return { guardianName: guardianName.trim(), guardianPhone, guardianConsentAt: new Date() };
}
