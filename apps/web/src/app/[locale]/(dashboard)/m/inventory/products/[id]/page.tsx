'use client';

import { useParams } from 'next/navigation';

import { ProductDetailView } from '@/features/inventory';

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  return <ProductDetailView id={params.id} />;
}
