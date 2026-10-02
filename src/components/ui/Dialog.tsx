import { IconXSquircle } from '@pierre/icons';
import { type ReactNode, useEffect, useRef } from 'react';

import { m } from '../../paraglide/messages.js';
import { getLocale } from '../../paraglide/runtime.js';
import { AnimatedHeight } from '@/components/ui/AnimatedHeight';
import { Button } from '@/components/ui/Button';
import { useSheetDrag } from '@/hooks/useSheetDrag';
import { cn } from '@/lib/cn';
import { textDirection } from '@/lib/locale';

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

// Two shapes of the same window.
//
// `card` is the window centred over the page, which is every dialog on a
// screen with room around it. `sheet` is iOS's: anchored to the bottom edge,
// as wide as the screen up to the card's own width, rising from below and
// pushing the page back behind it, with a grabber that says it can be swiped
// away and a gesture that does it. On a phone that is the shape a list is
// expected in — the bottom of the screen is where the thumb already is, and a
// card floating in the middle of 402px is a card with nowhere to float.
//
// The caller picks, because the caller knows what the window is for. Only a
// window that is a place to pick something from is a sheet today; a question
// with two answers is still a card on every screen.
export type DialogPresentation = 'card' | 'sheet';

interface DialogProps {
  children: ReactNode;
  /** Extra classes for the body region, below the title bar. */
  className?: string;
  onClose(): void;
  open: boolean;
  title: string;
  /**
   * Drawn before the title in the title bar, for a dialog that belongs to
   * something with a name of its own. The accessible name stays `title`.
   */
  eyebrow?: ReactNode;
  /** `card` unless stated. See `DialogPresentation`. */
  presentation?: DialogPresentation;
  /**
   * A row under the title, inside the sticky bar, for a control that acts on
   * the whole body — the way iOS puts a segmented control under a navigation
   * title. It stays in reach however far the body scrolls, and it is part of
   * the bar's height, so whatever the body pins under the bar pins under this
   * too. On a sheet it is part of the drag handle as well, and a press on one
   * of its controls is that control's and not a drag.
   */
  toolbar?: ReactNode;
}

export function Dialog({
  children,
  className,
  eyebrow,
  onClose,
  open,
  presentation = 'card',
  title,
  toolbar,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const sheet = presentation === 'sheet';
  useSheetDrag(ref, sheet && open, onClose);

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
      // A sheet swiped away was left at the bottom edge by the gesture, which
      // is where the closed state puts it too, so this changes nothing on
      // screen. It is cleared here so the next open starts from the
      // stylesheet's own values.
      element.style.removeProperty('transform');
    }
  }, [open]);

  return (
    <dialog
      dir={textDirection(getLocale())}
      ref={ref}
      aria-label={title}
      // The entrance and the exit are in globals.css, keyed on this attribute.
      // See the `dialog[data-app-dialog]` block there: the exit needs `display`
      // and `overlay` transitioned as discrete properties, and the entrance
      // needs `@starting-style`, neither of which is a class this app would
      // want stacked four variants deep on every dialog.
      data-app-dialog={presentation}
      className={cn(
        'border-line bg-raised text-ink fixed overflow-y-auto overscroll-contain border p-0 shadow-lg',
        'backdrop:bg-black/50 backdrop:backdrop-blur-[1px]',
        sheet
          ? // `max-w` is stated as well as `w`, because the user agent caps a
            // modal's width a margin short of the viewport and a sheet runs
            // edge to edge. The top keeps 2.5rem clear, which is the strip of
            // pushed-back page iOS leaves above a full-height sheet; the
            // bottom padding is the home indicator's, on a page that asks for
            // the safe area.
            'inset-x-0 top-auto bottom-0 mx-auto mt-auto mb-0 max-h-[calc(100dvh-2.5rem)] w-full max-w-[30rem] rounded-t-2xl border-b-0 pb-[env(safe-area-inset-bottom)]'
          : 'inset-0 m-auto max-h-[85vh] w-[min(30rem,calc(100vw-2rem))] rounded-xl',
        // The title bar's height, stated so that something sticky in the body
        // can stop under the bar rather than behind it: a 28px close button,
        // 8px above and below it, and the 1px rule. A sheet adds its grabber
        // above that — 6px of margin and the 5px pill — and gives back 4px of
        // the padding over the button, so the pill sits close to the title.
        // A toolbar adds the 44px of its own row, which says why below.
        toolbar == null
          ? sheet
            ? '[--app-sticky-top:52px]'
            : '[--app-sticky-top:45px]'
          : sheet
            ? '[--app-sticky-top:96px]'
            : '[--app-sticky-top:89px]'
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
      <div
        // The sheet's title bar is the handle a drag starts from, and it
        // claims the gesture outright: `touch-action: none` is what keeps the
        // browser from taking a downward swipe on it for a scroll.
        data-sheet-handle={sheet ? '' : undefined}
        className={cn(
          'border-line bg-raised sticky top-0 z-[2] flex h-(--app-sticky-top) flex-col border-b',
          sheet && 'cursor-grab touch-none select-none active:cursor-grabbing'
        )}
      >
        {sheet && (
          // The grabber: the one mark on a sheet that says it moves. It is
          // drawn and not a control, because the whole bar is the handle.
          <div
            aria-hidden
            className="bg-ink-faint/40 mx-auto mt-1.5 h-[5px] w-9 shrink-0 rounded-full"
          />
        )}
        <div
          className={cn(
            'flex min-h-0 flex-1 items-center gap-2 px-3',
            // A sheet centres its title the way an iOS navigation bar does,
            // with the close button at the trailing edge. `basis-0 grow` on
            // both sides is what keeps the title on the true centre whatever
            // the button's width.
            sheet ? 'pt-1 pb-2' : 'py-2'
          )}
        >
          {sheet && <span aria-hidden className="grow basis-0" />}
          <h2 className="text-ink flex min-w-0 items-center gap-2 text-sm font-semibold">
            {eyebrow}
            {title}
          </h2>
          <span
            className={cn(
              'flex justify-end',
              sheet ? 'grow basis-0' : 'ms-auto'
            )}
          >
            <Button
              aria-label={m.dialog_close()}
              size="icon-sm"
              title={m.dialog_close()}
              variant="quiet"
              onClick={onClose}
            >
              <IconXSquircle size={14} />
            </Button>
          </span>
        </div>
        {/* 44px: a 32px control in a 2px frame and its 2px padding, which is
            38, and 6px under it. The title row's own bottom padding is the
            space above. */}
        {toolbar != null && (
          <div className="flex h-11 shrink-0 items-start justify-center px-3">
            {toolbar}
          </div>
        )}
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
