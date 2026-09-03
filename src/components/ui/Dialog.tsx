import { IconXSquircle } from '@pierre/icons';
import { type ReactNode, useEffect, useRef } from 'react';

import { AnimatedHeight } from '@/components/ui/AnimatedHeight';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

// The platform's own dialog, driven by React state.
//
// `showModal()` brings the focus trap, the Escape key, the inert background, and
// the top layer, which sits above every stacking context including a portaled
// menu. Rebuilding those on a div would be a dependency or a pile of listeners,
// and both would be worse than what the browser already has.
//
// What it does not bring is a sensible landing place. `showModal()` focuses the
// first focusable thing it finds, and in every dialog here that is the close
// button in the title bar — so the browser arrived with Enter bound to shutting
// the window the reviewer had just opened. Two things outrank it, in this
// order: the first field, because a dialog with one is a dialog you came to
// type in, and then the control the dialog itself names with
// `dialogPrimaryAction`.
//
// That naming is the caller's and cannot be inferred, which is the whole reason
// for the attribute. Reading it off the accent — this app draws one filled
// control per screen — would be right for the watch-list offer and wrong twice
// over: `ReviewSubmitDialog` offers three verdicts and GitHub gives none of them
// a default, and the account dialog's one button is **Sign out**. A rule that
// guessed would bind Enter to signing the reviewer out.

// Stated once, and spread by the caller, so the selector below and the markup
// that answers it cannot come to disagree about the name.
const PRIMARY_ATTRIBUTE = 'data-dialog-primary';

/**
 * Marks the control a dialog opens onto, which is the one Enter presses.
 *
 * Spread it onto that control: `<Button {...dialogPrimaryAction}>`. A dialog
 * with a field of its own needs none of this — the field wins either way — and
 * a dialog whose actions have no obvious default should name nothing rather
 * than pick one.
 */
export const dialogPrimaryAction: Record<string, string> = {
  [PRIMARY_ATTRIBUTE]: '',
};

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
      // The field first, then the named action. Neither present leaves the
      // browser's own answer, which is the close button — the right one for a
      // dialog that is only there to be read. `focus()` on a disabled control
      // does nothing and lands in the same place, which is also right: a
      // primary action that cannot be pressed is not where Enter should go.
      const target =
        element.querySelector<HTMLElement>('input, textarea, select') ??
        element.querySelector<HTMLElement>(`[${PRIMARY_ATTRIBUTE}]`);
      target?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      // The entrance and the exit are in globals.css, keyed on this attribute.
      // See the `dialog[data-app-dialog]` block there: the exit needs `display`
      // and `overlay` transitioned as discrete properties, and the entrance
      // needs `@starting-style`, neither of which is a class this app would
      // want stacked four variants deep on every dialog.
      data-app-dialog=""
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
      {/* Every dialog travels between its content heights rather than snap
          between them. A dialog is centred by `m-auto`, so a jump moves all
          four of its edges at once and reads as a second window arriving in
          place of the first — the offer going from its question to its answer,
          a row leaving the watch list, a list of pull requests landing where a
          skeleton was. The title bar stays outside this box: it is `sticky` and
          the height being measured is the body's. */}
      <AnimatedHeight>
        <div className={cn('p-3', className)}>{children}</div>
      </AnimatedHeight>
    </dialog>
  );
}
