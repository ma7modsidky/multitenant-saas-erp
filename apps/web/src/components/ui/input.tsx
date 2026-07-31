'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '../cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-sm transition-colors',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error
            ? 'border-destructive focus-visible:ring-destructive'
            : 'border-input',
          className,
        )}
        ref={ref}
        aria-invalid={!!error}
        aria-describedby={error ? `${props.id}-error` : undefined}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
