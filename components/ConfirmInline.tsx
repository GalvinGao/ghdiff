'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

// A destructive action asks twice, in place.
//
// Deleting a thread removes real comments from GitHub and cannot be undone, so
// one stray click must not do it. The confirmation opens next to the button
// that armed it, with an arrow pointing back at it, so it is obvious which
// action is being confirmed. It is not a centred dialog: the thread being
// deleted is right there, and moving attention to the middle of the screen
// would lose it.

interface ConfirmInlineProps {
  /** Label of the resting button. */
  label: string;
  /** The question, and the label of the button that goes through with it. */
  question: string;
  confirmLabel: string;
  onConfirm(): void;
  className?: string;
}

export function ConfirmInline({
  className,
  confirmLabel,
  label,
  onConfirm,
  question,
}: ConfirmInlineProps) {
  const [armed, setArmed] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus lands on the confirming button, so Escape and Tab behave, but the
  // button is never the one under the pointer when the panel opens.
  useEffect(() => {
    if (armed) confirmRef.current?.focus();
  }, [armed]);

  useEffect(() => {
    if (!armed) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setArmed(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (wrapRef.current?.contains(event.target) === true) return;
      setArmed(false);
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [armed]);

  return (
    <span ref={wrapRef} className={cn('relative inline-flex', className)}>
      <Button
        variant="danger"
        size="sm"
        aria-expanded={armed}
        onClick={() => setArmed((current) => !current)}
      >
        {label}
      </Button>

      {armed && (
        <span
          role="alertdialog"
          aria-label={question}
          className={cn(
            'border-removed/60 bg-raised absolute top-full right-0 z-10 mt-2',
            'w-60 rounded-lg border p-2.5 shadow-xl',
            'reviewer-pop-in origin-top-right'
          )}
        >
          {/* The arrow points back at the button that armed this. */}
          <span
            aria-hidden="true"
            className="border-removed/60 bg-raised absolute -top-[5px] right-3 size-2 rotate-45 border-t border-l"
          />
          <span className="text-ink block text-xs leading-snug">
            {question}
          </span>
          <span className="mt-2 flex items-center gap-1.5">
            <Button
              ref={confirmRef}
              variant="solid"
              size="sm"
              className="border-removed bg-removed text-[var(--app-raised)]"
              onClick={() => {
                setArmed(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => setArmed(false)}>
              Cancel
            </Button>
          </span>
        </span>
      )}
    </span>
  );
}
