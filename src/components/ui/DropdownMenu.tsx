import { IconCheck } from '@pierre/icons';
import * as Primitive from '@radix-ui/react-dropdown-menu';
import {
  type ComponentProps,
  createContext,
  forwardRef,
  useContext,
  useRef,
  useState,
} from 'react';

import { cn } from '@/lib/cn';
import { textDirection } from '@/lib/locale';
import { getLocale } from '@/paraglide/runtime';

/**
 * Whether the menu is open, and the way to change it, for the trigger below.
 * Radix keeps its own copy out of reach, so the root holds the state and hands
 * Radix the controlled pair.
 */
const OpenState = createContext<{
  open: boolean;
  setOpen(open: boolean): void;
} | null>(null);

export function DropdownMenu({
  defaultOpen = false,
  dir = textDirection(getLocale()),
  onOpenChange,
  open: openProp,
  ...props
}: ComponentProps<typeof Primitive.Root>) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (openProp == null) setOwnOpen(next);
    onOpenChange?.(next);
  };
  return (
    <OpenState.Provider value={{ open, setOpen }}>
      <Primitive.Root dir={dir} {...props} open={open} onOpenChange={setOpen} />
    </OpenState.Provider>
  );
}

/**
 * Opens on a press for a mouse and on a tap for a finger.
 *
 * Radix opens a menu on `pointerdown`, which is right for a mouse — the menu is
 * there before the button comes back up, the way a native menu is. For a
 * finger it is wrong, because a touch that lands on a trigger is the start of
 * a scroll as often as a tap: the review header scrolls sideways on a phone,
 * and every swipe that began on the title opened its card. So a touch or a pen
 * cancels Radix's handler — it runs only when the event is not
 * default-prevented — and the menu opens on `click`, which the browser never
 * sends for a touch that became a scroll.
 */
export const DropdownMenuTrigger = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof Primitive.Trigger>
>(function DropdownMenuTrigger({ onClick, onPointerDown, ...props }, ref) {
  const state = useContext(OpenState);
  const touchRef = useRef(false);
  return (
    <Primitive.Trigger
      ref={ref}
      {...props}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        touchRef.current = event.pointerType !== 'mouse';
        if (touchRef.current) event.preventDefault();
      }}
      onClick={(event) => {
        onClick?.(event);
        // Enter and Space never reach here as a click: Radix prevents their
        // default on keydown and toggles the menu itself.
        if (!touchRef.current || state == null) return;
        touchRef.current = false;
        state.setOpen(!state.open);
      }}
    />
  );
});

export const DropdownMenuGroup = Primitive.Group;
export const DropdownMenuPortal = Primitive.Portal;

export function DropdownMenuContent({
  className,
  height = 'capped',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Primitive.Content> & {
  /**
   * `viewport` for a menu whose rows are a fixed set: the screen is then the
   * only thing allowed to cut it, because a menu that fits has no reason to
   * scroll and a row below the fold announces itself with nothing.
   *
   * The default is for a menu that can be long — the filter menu's eight
   * two-line presets run past 600px, and the account menu lists an
   * installation per account the reviewer has — where scrolling is the right
   * answer and 28rem is where it starts.
   */
  height?: 'capped' | 'viewport';
}) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(
          'border-line bg-raised text-ink z-50 min-w-56 overflow-y-auto rounded-lg border p-1 shadow-lg',
          height === 'viewport'
            ? 'max-h-[var(--radix-dropdown-menu-content-available-height)]'
            : 'max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))]',
          // A menu that scrolls must keep its scroll: without this, reaching
          // the end of the list hands the gesture to the page behind it, and
          // the whole app rubber-bands away from under the open menu.
          'overscroll-contain',
          'data-[state=open]:ghdiff-pop-in',
          className
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none',
        'data-[highlighted]:bg-surface data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    />
  );
}

/**
 * The mark on a chosen row, in the text's own colour, which is how diffs-hub
 * marks one. A tinted box or a coloured dot puts the loudest thing in the menu
 * on the setting that is already in force.
 *
 * The slot keeps its width while the row is unchecked, because `ItemIndicator`
 * renders nothing then and every label in the menu has to start on one line. It
 * is as tall as one line of the label, so it centres on the first line of a row
 * that carries two.
 */
function ItemCheck() {
  return (
    <span className="flex h-5 w-3.5 shrink-0 items-center justify-center">
      <Primitive.ItemIndicator>
        {/* `block`, because `ItemIndicator` renders a bare inline span and an
            inline box has a baseline gap under it. The mark this replaced was
            an empty inline span, which has no size at all and so drew
            nothing. */}
        <IconCheck className="text-ink block" size={13} />
      </Primitive.ItemIndicator>
    </span>
  );
}

export function DropdownMenuCheckboxItem({
  children,
  className,
  indicator = 'box',
  ...props
}: ComponentProps<typeof Primitive.CheckboxItem> & {
  /**
   * `switch` for a setting that takes effect the moment it is thrown, with the
   * control on the trailing edge where a settings list expects it. It stays a
   * menu checkbox item underneath, so the arrow keys and Enter still work; a
   * real switch element nested in here would be a control inside a control.
   */
  indicator?: 'box' | 'switch';
}) {
  const checked = props.checked === true;
  return (
    <Primitive.CheckboxItem
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none',
        'data-[highlighted]:bg-surface data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      {indicator === 'box' ? (
        <>
          <ItemCheck />
          {children}
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1">{children}</span>
          {/* On is ink, not accent: three of these sit in one short menu, and
              three saturated pills there read as an alert. Ink is also what
              the reference app fills a thrown switch with. */}
          <span
            aria-hidden="true"
            className={cn(
              'relative flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors',
              checked ? 'border-ink bg-ink' : 'border-line bg-surface'
            )}
          >
            <span
              className={cn(
                'size-3 rounded-full transition-transform',
                checked
                  ? 'bg-raised translate-x-3.5'
                  : 'bg-ink-faint translate-x-0.5'
              )}
            />
          </span>
        </>
      )}
    </Primitive.CheckboxItem>
  );
}

export function DropdownMenuRadioGroup(
  props: ComponentProps<typeof Primitive.RadioGroup>
) {
  return <Primitive.RadioGroup {...props} />;
}

export function DropdownMenuRadioItem({
  children,
  className,
  ...props
}: ComponentProps<typeof Primitive.RadioItem>) {
  return (
    <Primitive.RadioItem
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none',
        'data-[highlighted]:bg-surface data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      <ItemCheck />
      {children}
    </Primitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      // pt-1.5 rather than pt-2: the menu's own p-1 is already above this, and
      // the row that ends the menu leaves 6px plus that same p-1 below itself.
      // Anything more here and the menu looks hung from its top edge.
      className={cn(
        'text-ink-faint px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide uppercase',
        className
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Primitive.Separator>) {
  return (
    <Primitive.Separator
      // -mx-1 cancels the menu's padding, so the rule crosses the whole card
      // and reads as a division rather than as another row.
      className={cn('bg-line -mx-1 my-1 h-px', className)}
      {...props}
    />
  );
}

export const DropdownMenuSub = Primitive.Sub;

export function DropdownMenuSubTrigger({
  children,
  className,
  ...props
}: ComponentProps<typeof Primitive.SubTrigger>) {
  return (
    <Primitive.SubTrigger
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-surface data-[state=open]:bg-surface',
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <span aria-hidden="true" className="rtl:rotate-180">
        ›
      </span>
    </Primitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.SubContent>) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent
        className={cn(
          'border-line bg-raised text-ink z-50 max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] min-w-48 overflow-y-auto overscroll-contain rounded-lg border p-1 shadow-lg',
          className
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
