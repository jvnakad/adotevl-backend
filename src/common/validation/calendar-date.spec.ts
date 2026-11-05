import { isCalendarDate } from './calendar-date';

describe('isCalendarDate', () => {
  it.each(['2026-02-28', '2024-02-29', '2026-12-31'])('aceita %s', (value) => expect(isCalendarDate(value)).toBe(true));
  it.each(['2026-02-30', '2026-11-31', '2025-02-29', '2026-13-01', '2026-00-10', 'abc', '', null, 20260101])('recusa %s', (value) => expect(isCalendarDate(value)).toBe(false));
});
