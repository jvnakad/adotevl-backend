import { BadRequestException } from '@nestjs/common';
import { isValidIsoDate, localPeriod } from './stock-date';

describe('stock-date', () => {
  it.each([
    ['2026-12-31', true],
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-02-31', false],
    ['2026-13-01', false],
    ['2026-1-1', false],
    ['31/12/2026', false],
    ['', false],
    [null, false],
    [20261231, false],
  ])('isValidIsoDate(%j) = %s', (value, expected) => {
    expect(isValidIsoDate(value)).toBe(expected);
  });

  describe('localPeriod', () => {
    it('sem filtros não limita', () => {
      expect(localPeriod()).toEqual({ start: null, endExclusive: null });
    });

    it('usa o dia local de Brasília (UTC-3), inclusivo nas duas pontas', () => {
      const { start, endExclusive } = localPeriod('2026-10-10', '2026-10-15');

      expect(start.toISOString()).toBe('2026-10-10T03:00:00.000Z');
      // "até 15/10" vai até o fim do dia 15 em Brasília
      expect(endExclusive.toISOString()).toBe('2026-10-16T03:00:00.000Z');
    });

    it('o cadastro de 10/10 às 23:30 em Brasília conta no dia 10, não no 11', () => {
      const cadastro = new Date('2026-10-10T23:30:00-03:00');
      const { start, endExclusive } = localPeriod('2026-10-10', '2026-10-10');

      expect(cadastro >= start && cadastro < endExclusive).toBe(true);
      const outro = localPeriod('2026-10-11', '2026-10-11');
      expect(cadastro >= outro.start && cadastro < outro.endExclusive).toBe(false);
    });

    it('só "de" ou só "até"', () => {
      expect(localPeriod('2026-10-10').endExclusive).toBeNull();
      expect(localPeriod(undefined, '2026-10-10').start).toBeNull();
    });

    it('"de" maior que "até" é 400', () => {
      expect(() => localPeriod('2026-10-15', '2026-10-10')).toThrow(new BadRequestException('A data inicial não pode ser maior que a final.'));
    });

    it('mesmo dia nas duas pontas é válido', () => {
      expect(() => localPeriod('2026-10-10', '2026-10-10')).not.toThrow();
    });
  });
});
