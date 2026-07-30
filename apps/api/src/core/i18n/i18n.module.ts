import { Global, Module } from '@nestjs/common';
import { I18nService } from './i18n.service.js';

/**
 * I18nModule — internationalization infrastructure for the API layer.
 *
 * Provides:
 *   - I18nService: locale resolution (I18N-1), text direction,
 *     number/currency/date formatting (I18N-7)
 *
 * Wraps @modubiz/i18n which provides the locale catalogs for
 * en, ar, fr, and es (I18N-4).
 *
 * @see PLAN.md §1.8 — i18n
 * @see BUSINESS_RULES.md — I18N-1, I18N-4, I18N-7
 */
@Global()
@Module({
  providers: [I18nService],
  exports: [I18nService],
})
export class I18nModule {}
