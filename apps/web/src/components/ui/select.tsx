import { ChevronDown } from 'lucide-react';

import { cn } from '../cn';

/**
 * Lightweight accessible select built on a native `<select>`.
 * No external menu dependency — styling matches the design system.
 */

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
}

export function Select({ value, onValueChange, placeholder, className, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        {...props}
        value={value ?? ''}
        onChange={(e) => onValueChange?.(e.target.value)}
        className={cn(
          'flex h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 pe-8 text-sm shadow-sm transition-colors',
          'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          (value === undefined || value === '') && 'text-muted-foreground',
          className,
        )}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute end-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  );
}

export function SelectItem({
  value,
  children,
  ...props
}: React.OptionHTMLAttributes<HTMLOptionElement> & { value: string }) {
  return (
    <option {...props} value={value}>
      {children}
    </option>
  );
}
