'use client';

import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from '../cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, error, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-16 w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm transition-colors',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        error ? 'border-destructive focus-visible:ring-destructive' : 'border-input',
        className,
      )}
      ref={ref}
      aria-invalid={!!error}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
