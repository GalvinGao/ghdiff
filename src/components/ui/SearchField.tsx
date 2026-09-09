import { IconSearch } from '@pierre/icons';
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';

// A field with a magnifier in it, for the two searches on the review screen:
// the sidebar's path filter and find in diff. The glyph sits over the field's
// own padding, so the field stays one control and the glyph takes no lane of
// its own. A query is never a word to correct or a value to remember, so the
// browser is told to do neither.

export interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** For the box around the field, which is what a caller sizes. */
  wrapperClassName?: string;
  /** Drawn in that box after the field, for a control that sits in it. */
  children?: ReactNode;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField(
    { children, className, wrapperClassName, ...props },
    ref
  ) {
    return (
      <div className={cn('relative', wrapperClassName)}>
        <IconSearch
          className="text-ink-faint pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
          size={12}
        />
        <Input
          ref={ref}
          autoComplete="off"
          spellCheck={false}
          {...props}
          className={cn('h-7 pl-7 text-xs', className)}
        />
        {children}
      </div>
    );
  }
);
