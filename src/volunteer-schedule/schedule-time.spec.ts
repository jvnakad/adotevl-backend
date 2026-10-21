import { earliestStartToday } from './schedule-time';

const at = (iso: string) => earliestStartToday(new Date(iso));

describe('earliestStartToday', () => {
  it('próximo passo de 30 min estritamente depois de agora (fuso de Brasília)', () => {
    expect(at('2026-10-14T10:07:00-03:00')).toBe('10:30');
    expect(at('2026-10-14T10:30:00-03:00')).toBe('11:00');
    expect(at('2026-10-14T10:29:59-03:00')).toBe('10:30');
    expect(at('2026-10-14T10:00:00-03:00')).toBe('10:30');
  });

  it('usa o fuso de Brasília, não o UTC', () => {
    // 13:10 UTC = 10:10 em Brasília
    expect(at('2026-10-14T13:10:00Z')).toBe('10:30');
  });

  it('antes da abertura vale a abertura (dia útil 08:00, fim de semana 13:00)', () => {
    expect(at('2026-10-14T03:00:00-03:00')).toBe('08:00');
    expect(at('2026-10-14T07:40:00-03:00')).toBe('08:00');
    expect(at('2026-10-17T09:00:00-03:00')).toBe('13:00');
  });

  it('último início é 15:30; depois disso não sobra horário', () => {
    expect(at('2026-10-14T15:00:00-03:00')).toBe('15:30');
    expect(at('2026-10-14T15:30:00-03:00')).toBeNull();
    expect(at('2026-10-14T23:50:00-03:00')).toBeNull();
  });
});
