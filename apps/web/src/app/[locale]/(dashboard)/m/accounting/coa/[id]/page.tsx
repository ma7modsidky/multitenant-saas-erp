'use client';

import { useParams } from 'next/navigation';

import { AccountDetailView } from '@/features/accounting';

export default function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  return <AccountDetailView id={params.id} />;
}
