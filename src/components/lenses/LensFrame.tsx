import { IconGear } from '@pierre/icons';
import type { ReactNode } from 'react';

import { m } from '../../paraglide/messages.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { textDirection } from '@/lib/locale';
import { getLocale } from '@/paraglide/runtime.js';

// The one piece of chrome every lens panel shares.
//
// A lens replaces files a reviewer expected to see with something they did
// not ask for, so the replacement has to say what it is and how to be rid of
// it, in the same place on every panel. The strip above the card names it as
// a lens and as a beta; across from that, **Turn off** takes it away for this
// repository and the gear opens the lens's own menu. Turning off is one press
// and no dialog, because a view that is in the way should not ask to be argued
// with. What a lens lets the reviewer tune lives in that menu and not on the
// card, so the card holds the content and nothing else.

export function LensFrame({
  children,
  menu,
  onTurnOff,
  settingsLabel,
}: {
  children: ReactNode;
  /** The rows of the gear's menu. */
  menu: ReactNode;
  onTurnOff(): void;
  /** What the gear opens, for its accessible name. */
  settingsLabel: string;
}) {
  // A tray with the card laid over it, the way a composer sits on its own
  // toolbar: the tray shows only as the strip above the card, so the lens's
  // own controls read as belonging to the frame and not to the content. The
  // card's negative margins put its border over the tray's, so the two share
  // one outline down the sides and along the bottom.
  return (
    <div dir={textDirection(getLocale())} className="px-3 pt-3 pb-3">
      <div className="border-line bg-surface rounded-xl border">
        <div className="text-ink-faint flex h-8 items-center gap-1.5 px-3 text-[11px]">
          <LensBadge />
          <div className="ms-auto flex items-center gap-1">
            <button
              type="button"
              className="hover:text-ink rounded px-1 underline-offset-2 hover:underline"
              onClick={onTurnOff}
            >
              {m.lens_frame_turn_off()}
            </button>
            <span aria-hidden="true" className="bg-line h-3 w-px" />
            {/* modal={false}, so the table can be read against the choices
                being made in the menu. */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={settingsLabel}
                  className="hover:text-ink data-[state=open]:text-ink rounded p-1"
                  title={settingsLabel}
                >
                  <IconGear size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56"
                height="viewport"
              >
                {menu}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="border-line bg-raised -mx-px -mb-px overflow-hidden rounded-xl border shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * "Lens" and its beta mark, which is how every surface that belongs to a lens
 * names it: the frame, the settings dialog and the display menu's section.
 */
export function LensBadge() {
  return (
    <span className="text-ink-faint inline-flex items-center gap-1.5 text-[11px] font-normal">
      {m.lens_label()}
      <span className="border-line rounded border px-1 text-[10px] leading-3.5 tracking-wide uppercase">
        {m.lens_frame_beta()}
      </span>
    </span>
  );
}
