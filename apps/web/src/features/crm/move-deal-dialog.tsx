'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface MoveDealDialogProps {
  open: boolean;
  /** Deal being moved (for the dialog title). */
  dealTitle: string;
  /** Localized name of the target stage. */
  toStageName: string;
  /** Target stage is a lost stage → the reason is required (CRM-7). */
  requiresReason: boolean;
  /** Mutation in flight — disables all dismissal + confirm paths. */
  pending: boolean;
  onConfirm: (lostReasonCode?: string) => void;
  onCancel: () => void;
}

/**
 * MoveDealDialog — confirms a deal stage change, asking for the mandatory
 * lost-reason code when the target stage is a lost stage (CRM-7).
 *
 * Mirrors ConfirmDialog's a11y behavior (focus panel on open, Escape to
 * cancel, hidden backdrop) and adds a required text input for the reason.
 */
export function MoveDealDialog({
  open,
  dealTitle,
  toStageName,
  requiresReason,
  pending,
  onConfirm,
  onCancel,
}: MoveDealDialogProps) {
  const t = useTranslations('modules.crm');
  const panelRef = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setReason('');
    panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, pending, onCancel]);

  if (!open) return null;

  const reasonMissing = requiresReason && reason.trim() === '';

  function confirm() {
    if (reasonMissing) return;
    onConfirm(requiresReason ? reason.trim() : undefined);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-deal-dialog-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={onCancel}
        disabled={pending}
        aria-hidden="true"
        tabIndex={-1}
      />
      <div ref={panelRef} tabIndex={-1} className="relative w-full max-w-sm outline-none animate-fade-in">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <CardTitle id="move-deal-dialog-title" className="text-base">
                {t('deals.moveToStage', { stage: toStageName })}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="-me-1 -mt-1 size-7"
                onClick={onCancel}
                disabled={pending}
                aria-label={t('common.close')}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <p className="text-sm text-muted-foreground" dir="auto">
              {dealTitle}
            </p>
            {requiresReason && (
              <div className="space-y-2">
                <Label htmlFor="move-deal-reason">{t('deals.lostReason')}</Label>
                <Input
                  id="move-deal-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t('deals.lostReasonPlaceholder')}
                  autoComplete="off"
                  disabled={pending}
                />
                <p className="text-xs text-muted-foreground">{t('deals.lostReasonHint')}</p>
              </div>
            )}
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onCancel} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button onClick={confirm} disabled={reasonMissing} loading={pending}>
              {t('deals.move')}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
