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
          <span className="border-line flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border">
            <Primitive.ItemIndicator>
              <span className="bg-accent size-2 rounded-[1px]" />
            </Primitive.ItemIndicator>
          </span>
          {children}
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1">{children}</span>
          <span
            aria-hidden="true"
            className={cn(
              'relative flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors',
              checked ? 'border-accent bg-accent' : 'border-line bg-surface'
            )}
          >
            <span
              className={cn(
                'size-3 rounded-full transition-transform',
                checked
                  ? 'bg-accent-ink translate-x-3.5'
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
        'data-[highlighted]:bg-surface',
        className
      )}
      {...props}
    >
      <span className="border-line mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-full border">
        <Primitive.ItemIndicator>
          <span className="bg-accent size-1.5 rounded-full" />
        </Primitive.ItemIndicator>
      </span>
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
      className={cn(
        'text-ink-faint px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase',
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
      className={cn('bg-line my-1 h-px', className)}
      {...props}
    />
  );
}
