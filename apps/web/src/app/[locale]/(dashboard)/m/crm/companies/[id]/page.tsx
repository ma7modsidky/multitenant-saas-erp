'use client';

import { useParams } from 'next/navigation';

import { CompanyDetailView } from '@/features/crm/details';

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  return <CompanyDetailView id={params.id} />;
}
