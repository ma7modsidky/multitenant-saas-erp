import { describe, expect, it } from 'vitest';

// Import directly from @modubiz/i18n for the pure functions
// The I18nService is a thin wrapper, so we test both the service and the underlying library
import { I18nService } from '../i18n.service.js';

// ─── I18N-1: Locale resolution order ────────────────────────────────────────

describe('I18N-1: Locale resolution order', () => {
  const service = new I18nService();

  it('I18N-1: explicit request takes priority', () => {
    const result = service.resolve('ar', 'fr', 'en');
    expect(result).toBe('ar');
  });

  it('I18N-1: user preference comes second', () => {
    const result = service.resolve(null, 'fr', 'en');
    expect(result).toBe('fr');
  });

  it('I18N-1: org default comes third', () => {
    const result = service.resolve(null, null, 'es');
    expect(result).toBe('es');
  });

  it('I18N-1: Accept-Language comes fourth', () => {
    const result = service.resolve(null, null, null, 'fr-FR, en;q=0.9');
    expect(result).toBe('fr');
  });

  it('I18N-1: falls back to en when nothing is specified', () => {
    const result = service.resolve(null, null, null, null);
    expect(result).toBe('en');
  });

  it('I18N-1: falls back to en when an unsupported locale is specified', () => {
    const result = service.resolve('de');
    expect(result).toBe('en');
  });

  it('I18N-1: empty Accept-Language falls back to en', () => {
    const result = service.resolve(null, null, null, '');
    expect(result).toBe('en');
  });
});

// ─── I18N-4: Supported locale catalogs ──────────────────────────────────────

describe('I18N-4: Supported locale catalogs', () => {
  const service = new I18nService();

  it('I18N-4: supports en locale', () => {
    expect(service.isSupported('en')).toBe(true);
  });

  it('I18N-4: supports ar locale', () => {
    expect(service.isSupported('ar')).toBe(true);
  });

  it('I18N-4: supports fr locale', () => {
    expect(service.isSupported('fr')).toBe(true);
  });

  it('I18N-4: supports es locale', () => {
    expect(service.isSupported('es')).toBe(true);
  });

  it('I18N-4: returns exactly 4 supported locales', () => {
    const locales = service.getSupportedLocales();
    expect(locales).toHaveLength(4);
    expect(locales).toEqual(expect.arrayContaining(['en', 'ar', 'fr', 'es']));
  });

  it('I18N-4: does not support unsupported locales', () => {
    expect(service.isSupported('de')).toBe(false);
    expect(service.isSupported('zh')).toBe(false);
    expect(service.isSupported('pt')).toBe(false);
  });

  it('I18N-4: direction is rtl for ar', () => {
    expect(service.getDirection('ar')).toBe('rtl');
  });

  it('I18N-4: direction is ltr for en, fr, es', () => {
    expect(service.getDirection('en')).toBe('ltr');
    expect(service.getDirection('fr')).toBe('ltr');
    expect(service.getDirection('es')).toBe('ltr');
  });
});

// ─── I18N-7: Formatters produce locale-correct output ───────────────────────

describe('I18N-7: Locale-correct formatting', () => {
  const service = new I18nService();

  describe('formatNumber', () => {
    it('I18N-7: formats number with US locale', () => {
      const result = service.formatNumber(1234567.89, 'en');
      expect(result).toContain('1');
      expect(result).not.toBe('1234567.89'); // Should have grouping separators
    });

    it('I18N-7: formats number in Arabic locale', () => {
      // The number formatter should use Arabic digits or Latin digits
      const result = service.formatNumber(1234.5, 'ar');
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('I18N-7: formats number with custom options', () => {
      const result = service.formatNumber(0.5, 'en', { style: 'percent' });
      expect(result).toBe('50%');
    });

    it('I18N-7: handles zero', () => {
      const result = service.formatNumber(0, 'en');
      expect(result).toBe('0');
    });
  });

  describe('formatMoney', () => {
    it('I18N-7: formats USD amount', () => {
      const result = service.formatMoney(10050n, 'USD', 'en');
      expect(result).toContain('100.50');
    });

    it('I18N-7: formats JPY amount (zero decimal)', () => {
      const result = service.formatMoney(500n, 'JPY', 'en');
      // JPY has 0 decimal places, so 500 minor units = ¥500
      expect(result).toContain('500');
    });

    it('I18N-7: formats KWD amount (3 decimal)', () => {
      const result = service.formatMoney(10050n, 'KWD', 'en');
      // KWD has 3 decimal places, so 10050 minor units = 10.050 KWD
      expect(result).toContain('10.050');
    });

    it('I18N-7: handles zero amount', () => {
      const result = service.formatMoney(0n, 'USD', 'en');
      expect(result).toContain('0');
    });
  });

  describe('formatDate', () => {
    it('I18N-7: formats date in US locale', () => {
      // Use a date with unambiguous formatting
      const date = new Date('2024-06-15T12:00:00Z');
      const result = service.formatDate(date, 'en', 'UTC', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      expect(result).toContain('June');
      expect(result).toContain('15');
      expect(result).toContain('2024');
    });

    it('I18N-7: formats date in French locale', () => {
      const date = new Date('2024-06-15T12:00:00Z');
      const result = service.formatDate(date, 'fr', 'UTC', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      // French formatting
      expect(result).toContain('juin');
      expect(result).toContain('2024');
    });

    it('I18N-7: formats date in Arabic locale', () => {
      const date = new Date('2024-06-15T12:00:00Z');
      const result = service.formatDate(date, 'ar', 'UTC', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('I18N-7: handles timezone conversion', () => {
      const date = new Date('2024-06-15T12:00:00Z');
      const result = service.formatDate(date, 'en', 'America/New_York', {
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });

      expect(result).toBeDefined();
      // NY is UTC-4 in June, so 12:00 UTC = 08:00 EDT
      expect(result).toContain('08');
    });
  });
});
