'use client';

import { useParams } from 'next/navigation';

import { CreditNoteDetailView } from '@/features/accounting';

export default function CreditNoteDetailPage() {
  const params = useParams<{ id: string }>();
  return <CreditNoteDetailView id={params.id} />;
}
