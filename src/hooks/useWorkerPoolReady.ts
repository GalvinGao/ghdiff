import { useWorkerPool } from '@pierre/diffs/react';
import { useEffect, useRef, useState } from 'react';

/**
 * Whether the highlighting workers can accept work.
 *
 * The viewer must not mount before this is true. A CodeView that mounts against
 * an uninitialized pool tokenizes its first screen of files on the main thread,
 * which is the stutter the pool exists to remove. It returns true when there is
 * no pool at all, so a surface rendered without the provider still works.
 */
export function useWorkerPoolReady(): boolean {
  const pool = useWorkerPool();
  const [ready, setReady] = useState(() => pool?.isInitialized() ?? true);
  const readyRef = useRef(ready);

  useEffect(() => {
    // The callback fires immediately with the current stats, so there is no
    // need to read the state again here.
    return pool?.subscribeToStatChanges((stats) => {
      const next = stats.managerState === 'initialized';
      if (next !== readyRef.current) {
        readyRef.current = next;
        setReady(next);
      }
    });
  }, [pool]);

  return ready;
}
