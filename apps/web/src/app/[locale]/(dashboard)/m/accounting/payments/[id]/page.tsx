'use client';

import { useParams } from 'next/navigation';

import { PaymentDetailView } from '@/features/accounting';

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  return <PaymentDetailView id={params.id} />;
}
