import { todayInBrazil } from '../volunteer-schedule/schedule-time';

export type DueStatus = 'overdue' | 'today' | 'upcoming' | 'none' | 'done';

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
};

/**
 * Situação do prazo (C16, D-10). `today` é o dia de Brasília ('YYYY-MM-DD'). Datas sem hora, comparadas como texto/dia.
 * - sem prazo: none;
 * - card na fila final: done (nunca atrasado, mesmo com prazo vencido);
 * - prazo antes de hoje: overdue, com overdueDays = dias de atraso;
 * - prazo hoje: today; depois: upcoming.
 */
export function dueInfo(dueDate: string | null, inFinalList: boolean, today: string = todayInBrazil()) {
  if (!dueDate) return { isOverdue: false, overdueDays: 0, dueStatus: 'none' as DueStatus };
  if (inFinalList) return { isOverdue: false, overdueDays: 0, dueStatus: 'done' as DueStatus };
  if (dueDate < today) return { isOverdue: true, overdueDays: Math.round(dayNumber(today) - dayNumber(dueDate)), dueStatus: 'overdue' as DueStatus };
  return { isOverdue: false, overdueDays: 0, dueStatus: (dueDate === today ? 'today' : 'upcoming') as DueStatus };
}
