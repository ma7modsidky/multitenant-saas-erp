'use client';

import { forwardRef, isValidElement, cloneElement, Children, type ButtonHTMLAttributes, type ReactElement } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render a different element instead of <button> */
  asChild?: boolean;
  /** Show a loading spinner */
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant, size, className }));

    // Spinner element
    const spinner = (
      <svg
        className="size-4 animate-spin"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
        key="spinner"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    );

    // When asChild is used, clone the child element and add our classes and props
    if (asChild && isValidElement(children)) {
      // eslint-disable-next-line no-restricted-syntax -- unavoidable: Children.only typing limitation
      const child = Children.only(children) as ReactElement<Record<string, unknown>>;
      return cloneElement(child, {
        // eslint-disable-next-line no-restricted-syntax -- unavoidable: unknown props type
        className: cn(classes, child.props.className as string | undefined),
        'aria-busy': loading || undefined,
        disabled: disabled || loading || undefined,
        ...props,
      });
    }

    return (
      <button
        className={classes}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading}
        {...props}
      >
        {loading ? [spinner, children] : children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
