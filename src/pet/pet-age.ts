// Nascimento do pet é mês/ano aproximado ('YYYY-MM'); a idade é sempre calculada na hora.

export const BIRTH_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Mês atual ('YYYY-MM') no fuso de Brasília. */
export const currentMonthInBrazil = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(now);

const toMonths = (yearMonth: string) => {
  const [year, month] = yearMonth.split('-').map(Number);
  return year * 12 + (month - 1);
};

const plural = (value: number, singular: string, pluralForm: string) => `${value} ${value === 1 ? singular : pluralForm}`;

/** '2 anos e 3 meses', '8 meses', 'menos de 1 mês'. */
export function petAgeLabel(birthDate: string | null, now = currentMonthInBrazil()): string | null {
  if (!birthDate) return null;
  const total = Math.max(0, toMonths(now) - toMonths(birthDate));
  const years = Math.floor(total / 12);
  const months = total % 12;
  if (years === 0) return months === 0 ? 'menos de 1 mês' : plural(months, 'mês', 'meses');
  const yearsLabel = plural(years, 'ano', 'anos');
  return months === 0 ? yearsLabel : `${yearsLabel} e ${plural(months, 'mês', 'meses')}`;
}

/** '07/2024 (2 anos e 3 meses)' — usado no termo de adoção. */
export function petBirthWithAge(birthDate: string | null, now = currentMonthInBrazil()): string {
  if (!birthDate) return '';
  const [year, month] = birthDate.split('-');
  return `${month}/${year} (${petAgeLabel(birthDate, now)})`;
}
