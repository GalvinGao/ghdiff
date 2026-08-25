'use client';

import { IconXSquircle } from '@pierre/icons';
import { type ReactNode, useEffect, useRef } from 'react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

// The platform's own dialog, driven by React state.
//
// `showModal()` brings the focus trap, the Escape key, the inert background, and
// the top layer, which sits above every stacking context including a portaled
// menu. Rebuilding those on a div would be a dependency or a pile of listeners,
// and both would be worse than what the browser already has.

interface DialogProps {
  children: ReactNode;
  /** Extra classes for the body region, below the title bar. */
  className?: string;
  onClose(): void;
  open: boolean;
  title: string;
}

export function Dialog({
  children,
  className,
  onClose,
  open,
  title,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (element == null) return;
    if (open && !element.open) {
      element.showModal();
      // Without this the browser lands on the first focusable thing, which is
      // the close button, and Enter would then shut the dialog the reviewer
      // just opened. The first field is what they came here to type in.
      element.querySelector<HTMLElement>('input, textarea, select')?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={cn(
        'border-line bg-raised text-ink fixed inset-0 m-auto max-h-[85vh] w-[min(30rem,calc(100vw-2rem))]',
        'overflow-y-auto overscroll-contain rounded-xl border p-0 shadow-lg',
        'backdrop:bg-black/50 backdrop:backdrop-blur-[1px]'
      )}
      // Escape fires `cancel`. React state stays the one source of truth for
      // whether this is open, so the default close is replaced by the callback.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click that lands on the dialog element itself landed on the backdrop:
      // every part of the content is inside a child.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="border-line bg-raised sticky top-0 flex items-center gap-2 border-b px-3 py-2">
        <h2 className="text-ink text-sm font-semibold">{title}</h2>
        <Button
          aria-label="Close"
          className="ml-auto"
          size="icon-sm"
          title="Close"
          variant="quiet"
          onClick={onClose}
        >
          <IconXSquircle size={14} />
        </Button>
      </div>
      <div className={cn('p-3', className)}>{children}</div>
    </dialog>
  );
}
