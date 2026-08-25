import { type ButtonHTMLAttributes, forwardRef } from 'react';

import {
  buttonClass,
  type ButtonSize,
  type ButtonVariant,
} from '@/components/ui/buttonClass';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = 'outline', size = 'md', ...props },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={props.type ?? 'button'}
        className={buttonClass({ className, size, variant })}
        {...props}
      />
    );
  }
);
