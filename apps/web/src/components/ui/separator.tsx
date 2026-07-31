import type { HTMLAttributes } from 'react';

import { cn } from '../cn';

interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
}

function Separator({ className, orientation = 'horizontal', ...props }: SeparatorProps) {
  return (
    <div
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      role="separator"
      aria-orientation={orientation}
      {...props}
    />
  );
}

export { Separator };
