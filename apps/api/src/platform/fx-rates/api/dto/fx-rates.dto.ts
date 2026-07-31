export interface FxRateResponse {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  validOn: string;
  source: string;
}

export interface FxRatesListResponse {
  baseCurrency: string;
  rates: Array<{
    quoteCurrency: string;
    rate: string;
    validOn: string;
  }>;
}

export interface CurrencyResponse {
  code: string;
  exponent: number;
  symbol: string;
  name: string;
}
