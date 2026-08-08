'use client';

import { useParams } from 'next/navigation';

import { StockCountDetailView } from '@/features/inventory';

export default function StockCountDetailPage() {
  const params = useParams<{ id: string }>();
  return <StockCountDetailView id={params.id} />;
}
