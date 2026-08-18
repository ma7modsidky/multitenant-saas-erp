'use client';

import { redirect } from 'next/navigation';
import { useLocale } from 'next-intl';

export default function PurchasingPage() {
  const locale = useLocale();
  redirect(`/${locale}/m/purchasing/suppliers`);
}
