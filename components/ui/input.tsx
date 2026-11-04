'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-lg border bg-black/30 px-3 text-sm text-cream outline-none transition placeholder:text-stone-600',
        invalid ? 'border-red-500/60 focus:border-red-400' : 'border-white/10 focus:border-gold/60',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
