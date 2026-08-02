// Shared hook for the organization localization fields (country, currency,
// timezone). Used by both the onboarding form (dashboard page) and the
// organization settings page, so the pickers behave identically everywhere.
//
// Returns the field state + setters, the searchable Combobox option lists
// (localized), and a country-change handler that auto-fills the currency.

'use client';

import { useMemo, useState } from 'react';

import type { ComboboxOption } from '@/components/ui/combobox';
import { currencyForCountry, getCountries } from '@/lib/l10n/countries';
import { getCurrencies } from '@/lib/l10n/currencies';
import { getTimezones } from '@/lib/l10n/timezones';

export interface OrgLocalizationOptions {
  countryCode?: string;
  baseCurrency?: string;
  timezone?: string;
}

export function useOrgLocalization(locale: string, initial: OrgLocalizationOptions = {}) {
  const [countryCode, setCountryCode] = useState(initial.countryCode ?? '');
  const [baseCurrency, setBaseCurrency] = useState(initial.baseCurrency ?? '');
  const [timezone, setTimezone] = useState(initial.timezone ?? '');

  const countryOptions = useMemo<ComboboxOption[]>(
    () => getCountries(locale).map((c) => ({ value: c.code, label: c.name, hint: c.code })),
    [locale],
  );
  const currencyOptions = useMemo<ComboboxOption[]>(
    () => getCurrencies(locale).map((c) => ({ value: c.code, label: c.name, hint: c.code })),
    [locale],
  );
  const timezoneOptions = useMemo<ComboboxOption[]>(
    () => getTimezones().map((tz) => ({ value: tz.id, label: tz.label })),
    [],
  );

  // Picking a country auto-fills the currency (ORG-4 convenience). The user
  // can still override the currency afterwards.
  const handleCountryChange = (code: string) => {
    setCountryCode(code);
    const currency = currencyForCountry(code);
    if (currency) setBaseCurrency(currency);
  };

  return {
    countryCode,
    baseCurrency,
    timezone,
    setCountryCode,
    setBaseCurrency,
    setTimezone,
    countryOptions,
    currencyOptions,
    timezoneOptions,
    handleCountryChange,
  };
}
