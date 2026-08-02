'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { cn } from '../cn';

import { Button } from './button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './card';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string | undefined;
  confirmLabel: string;
  cancelLabel: string;
  /** Accessible name for the corner X button — must differ from cancelLabel
      so getByRole('button', { name: cancelLabel }) stays unambiguous. */
  closeLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * ConfirmDialog — a small accessible modal for destructive or consequential
 * actions (remove member, change role, revoke invitation).
 *
 * Built on the design-system Card + a fixed overlay (no Radix dependency in
 * this project's web app). Focuses the panel on open, closes on Escape, and
 * hides the dismissal surface from assistive tech (the footer buttons +
 * Escape cover keyboard users).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  closeLabel,
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      // Escape is suppressed while loading, matching the disabled X/Cancel
      // buttons — an in-flight destructive action must not be dismissable.
      if (event.key === 'Escape' && !loading) onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onCancel]);

  useEffect(() => {
    if (!open) return;
    // Focus the dialog panel so keyboard users can Escape; Tab cycling stays
    // within the (small, two-button) dialog content.
    panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby={description ? 'confirm-dialog-description' : undefined}
    >
      {/* Backdrop — a visual dismissal surface, not a meaningful interactive
          element for assistive tech (the Escape key + Cancel button cover
          keyboard users). Hidden from the a11y tree so it never collides with
          the footer Cancel button's accessible name. Disabled while loading so
          an in-flight action cannot be dismissed (same rule as Escape + X). */}
      <button
        type="button"
        className="absolute inset-0 bg-black/50 cursor-default"
        onClick={onCancel}
        disabled={loading}
        aria-hidden="true"
        tabIndex={-1}
        data-testid="confirm-dialog-backdrop"
      />

      {/* Escape is handled by the document-level listener above (added while
          open), so no panel-level handler is needed — a duplicate would fire
          twice for one keypress (panel then document bubble). */}
      <div ref={panelRef} tabIndex={-1} className="relative w-full max-w-sm outline-none animate-fade-in">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <CardTitle id="confirm-dialog-title" className="text-base">
                {title}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="-me-1 -mt-1 size-7"
                onClick={onCancel}
                disabled={loading}
                aria-label={closeLabel}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </CardHeader>
          {description && (
            <CardContent className="pt-0">
              <p id="confirm-dialog-description" className="text-sm text-muted-foreground">
                {description}
              </p>
            </CardContent>
          )}
          <CardFooter className="justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onCancel} disabled={loading}>
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              onClick={onConfirm}
              loading={loading}
              className={cn(destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
            >
              {confirmLabel}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
