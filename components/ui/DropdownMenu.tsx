'use client';

import { IconCheck } from '@pierre/icons';
import * as Primitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuGroup = Primitive.Group;
export const DropdownMenuPortal = Primitive.Portal;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(
          'border-line bg-raised text-ink z-50 max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] min-w-56 overflow-y-auto rounded-lg border p-1 shadow-lg',
          // A menu that scrolls must keep its scroll: without this, reaching
          // the end of the list hands the gesture to the page behind it, and
          // the whole app rubber-bands away from under the open menu.
          'overscroll-contain',
          'data-[state=open]:reviewer-pop-in',
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
