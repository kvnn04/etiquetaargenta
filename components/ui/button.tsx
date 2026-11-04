'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-gold-strong text-[#fff8ef] shadow-md shadow-amber-900/25 hover:brightness-110',
        green: 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30 hover:bg-emerald-500',
        secondary: 'bg-white/5 text-stone-200 border border-white/10 hover:bg-white/10',
        outline: 'border border-white/15 text-stone-300 hover:border-gold/40 hover:text-gold-soft',
        ghost: 'text-stone-300 hover:bg-white/5 hover:text-white',
        subtleGold: 'bg-white/5 text-gold-soft border border-gold/30 hover:bg-white/10',
      },
      size: {
        sm: 'h-8 rounded-md px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-11 px-5 text-sm',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
