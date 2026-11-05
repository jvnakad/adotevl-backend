import { dueInfo } from './marketing-due';
import { todayInBrazil } from '../volunteer-schedule/schedule-time';

describe('dueInfo', () => {
  const today = '2026-10-20';

  it('sem prazo: none, nunca atrasado', () => {
    expect(dueInfo(null, false, today)).toEqual({ isOverdue: false, overdueDays: 0, dueStatus: 'none' });
  });

  it('prazo vencido fora da fila final: atrasado com os dias de atraso', () => {
    expect(dueInfo('2026-10-19', false, today)).toEqual({ isOverdue: true, overdueDays: 1, dueStatus: 'overdue' });
    expect(dueInfo('2026-09-20', false, today)).toEqual({ isOverdue: true, overdueDays: 30, dueStatus: 'overdue' });
  });

  it('prazo vencido na fila final: done, não atrasado', () => {
    expect(dueInfo('2026-10-01', true, today)).toEqual({ isOverdue: false, overdueDays: 0, dueStatus: 'done' });
  });

  it('prazo hoje: today (não é atrasado)', () => {
    expect(dueInfo('2026-10-20', false, today)).toEqual({ isOverdue: false, overdueDays: 0, dueStatus: 'today' });
  });

  it('prazo futuro: upcoming', () => {
    expect(dueInfo('2026-10-21', false, today)).toEqual({ isOverdue: false, overdueDays: 0, dueStatus: 'upcoming' });
  });

  it('conta dias corretamente na virada de mês e de ano', () => {
    expect(dueInfo('2025-12-31', false, '2026-01-01').overdueDays).toBe(1);
    expect(dueInfo('2026-02-28', false, '2026-03-01').overdueDays).toBe(1);
  });

  it('hoje vem do fuso de Brasília: 02:00 UTC ainda é o dia anterior', () => {
    // 2026-10-21T02:00Z = 2026-10-20 23:00 em Brasília
    const today = todayInBrazil(new Date('2026-10-21T02:00:00Z'));

    expect(today).toBe('2026-10-20');
    expect(dueInfo('2026-10-20', false, today).dueStatus).toBe('today');
    expect(dueInfo('2026-10-20', false, todayInBrazil(new Date('2026-10-21T03:00:00Z'))).dueStatus).toBe('overdue');
  });
});
