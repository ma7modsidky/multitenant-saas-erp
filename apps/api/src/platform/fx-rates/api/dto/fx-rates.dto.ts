import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * FX rate response payload.
 */
export const fxRateResponseSchema = z.object({
  baseCurrency: z.string(),
  quoteCurrency: z.string(),
  rate: z.string(),
  validOn: z.string(),
  source: z.string(),
});

/**
 * FX rate response DTO.
 */
export class FxRateResponse extends createZodDto(fxRateResponseSchema) {}

/**
 * FX rates list response payload.
 */
export const fxRatesListResponseSchema = z.object({
  baseCurrency: z.string(),
  rates: z.array(
    z.object({
      quoteCurrency: z.string(),
      rate: z.string(),
      validOn: z.string(),
    }),
  ),
});

/**
 * FX rates list response DTO.
 */
export class FxRatesListResponse extends createZodDto(fxRatesListResponseSchema) {}

/**
 * Currency response payload.
 */
export const currencyResponseSchema = z.object({
  code: z.string(),
  exponent: z.number(),
  symbol: z.string(),
  name: z.string(),
});

/**
 * Currency response DTO.
 */
export class CurrencyResponse extends createZodDto(currencyResponseSchema) {}

// ─── Response envelopes (match the `{ data }` wire format) ────────────────

/** `{ data: CurrencyResponse[] }` — list currencies. */
export const currenciesEnvelopeSchema = z.object({
  data: z.array(currencyResponseSchema),
});

export class CurrenciesEnvelopeResponse extends createZodDto(currenciesEnvelopeSchema) {}

/** `{ data: FxRatesListResponse }` — rates for a base currency. */
export const fxRatesEnvelopeSchema = z.object({
  data: fxRatesListResponseSchema,
});

export class FxRatesEnvelopeResponse extends createZodDto(fxRatesEnvelopeSchema) {}

/** `{ data: FxRateResponse }` — single rate. */
export const fxRateEnvelopeSchema = z.object({
  data: fxRateResponseSchema,
});

export class FxRateEnvelopeResponse extends createZodDto(fxRateEnvelopeSchema) {}

/** `{ data: { pairsStored; source } }` — snapshot result. */
export const fxSnapshotEnvelopeSchema = z.object({
  data: z.object({
    pairsStored: z.number(),
    source: z.string(),
  }),
});

export class FxSnapshotEnvelopeResponse extends createZodDto(fxSnapshotEnvelopeSchema) {}
