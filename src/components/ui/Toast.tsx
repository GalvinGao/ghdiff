import { IconXSquircle } from '@pierre/icons';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/Button';

// A short message about something the reviewer just did, which goes away by
// itself.
//
// For the one kind of press that changes the screen and would otherwise leave
// the reviewer asking where the thing went and how to get it back. It floats
// over the foot of the window rather than taking a row of the layout, because
// a row would move the diff under the pointer that made the press. The timer
// holds while the pointer is on it, so an action on it cannot run out from
// under the reviewer reaching for it.

const TOAST_MS = 8000;

export function Toast({
  action,
  children,
  onDismiss,
}: {
  action?: { label: string; onPress(): void };
  children: string;
  onDismiss(): void;
}) {
  const timer = useRef<number | undefined>(undefined);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  const start = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => dismissRef.current(), TOAST_MS);
  };
  const hold = () => window.clearTimeout(timer.current);

  useEffect(() => {
    timer.current = window.setTimeout(() => dismissRef.current(), TOAST_MS);
    return () => window.clearTimeout(timer.current);
  }, []);

  return (
    <div
      role="status"
      className="border-line bg-raised text-ink fixed bottom-4 left-1/2 z-50 flex max-w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg border py-2 pr-2 pl-3 text-sm shadow-lg transition-[opacity,translate] duration-200 starting:translate-y-2 starting:opacity-0"
      onPointerEnter={hold}
      onPointerLeave={start}
    >
      <p className="min-w-0 flex-1">{children}</p>
      {action != null && (
        <Button size="sm" variant="outline" onClick={action.onPress}>
          {action.label}
        </Button>
      )}
      <Button
        aria-label="Dismiss"
        size="icon-sm"
        title="Dismiss"
        variant="quiet"
        onClick={onDismiss}
      >
        <IconXSquircle size={13} />
      </Button>
    </div>
  );
}
