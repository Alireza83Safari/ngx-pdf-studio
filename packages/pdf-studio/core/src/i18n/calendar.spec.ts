import { formatDate } from './calendar';

const utc = (iso: string): Date => new Date(iso);

describe('formatDate (§11, ADR-0002)', () => {
  it('formats Gregorian dates', () => {
    expect(formatDate(utc('2026-06-24T08:30:00Z'), 'yyyy-MM-dd HH:mm', 'gregorian')).toBe(
      '2026-06-24 08:30',
    );
  });

  it('formats Jalali dates (Nowruz 1402 = 21 March 2023)', () => {
    expect(formatDate(utc('2023-03-21T00:00:00Z'), 'yyyy/MM/dd', 'jalali')).toBe('1402/01/01');
    expect(formatDate(utc('2026-06-24T00:00:00Z'), 'yyyy/MM/dd', 'jalali')).toBe('1405/04/03');
  });

  it('is timezone-independent (formats UTC components deterministically)', () => {
    const original = process.env.TZ;
    try {
      const at = utc('2026-06-24T23:30:00Z');
      process.env.TZ = 'America/Los_Angeles';
      const west = formatDate(at, 'yyyy-MM-dd HH:mm', 'gregorian');
      process.env.TZ = 'Asia/Tokyo';
      const east = formatDate(at, 'yyyy-MM-dd HH:mm', 'gregorian');
      expect(west).toBe('2026-06-24 23:30');
      expect(east).toBe('2026-06-24 23:30');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
