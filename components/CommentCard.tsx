'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CommentBody } from '@/components/CommentBody';
import { CommentExpansion } from '@/components/CommentExpansion';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { measureCommentBody } from '@/lib/commentHeight';
import { type CommentMetadata, isSavedComment } from '@/lib/comments';

interface CommentCardProps {
  itemId: string;
  metadata: CommentMetadata;
  onDelete(itemId: string, key: string): void;
}

/**
 * One saved comment inside the diff.
 *
 * The body region has a height chosen from the text before the first paint and
 * never changes it. @pierre/diffs watches this element with a ResizeObserver,
 * so a card that grew would relay out the virtualized list. Reading the rest
 * happens in an overlay instead. See lib/commentHeight.ts.
 */
export function CommentCard({ itemId, metadata, onDelete }: CommentCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  // The element the overlay grows from. It is captured in the click handler,
  // because a ref must not be read while rendering.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [clipped, setClipped] = useState(false);

  const spec = useMemo(
    () => measureCommentBody(metadata.body),
    [metadata.body]
  );

  // One layout read when the body mounts, to decide whether the fade and the
  // expand control belong here. It reads a height, it never sets one, so the
  // card's own size is unaffected.
  const measureClipping = useCallback((node: HTMLDivElement | null) => {
    bodyRef.current = node;
    if (node == null) return;

    const check = () => {
      const current = bodyRef.current;
      if (current != null) {
        setClipped(current.scrollHeight - current.clientHeight > 2);
      }
    };
    check();

    // A lazy image has no height until it loads, so a comment whose overflow is
    // an image would otherwise never offer the expand control. The load event
    // does not bubble, so it is caught on the way down.
    node.addEventListener('load', check, true);
    cleanupRef.current = () => node.removeEventListener('load', check, true);
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

  const open = useCallback(() => setAnchor(cardRef.current), []);
  const close = useCallback(() => setAnchor(null), []);

  // Every hook above runs unconditionally, so the early exit comes last.
  if (!isSavedComment(metadata)) return null;

  return (
    <div
      ref={cardRef}
      className="border-line bg-raised text-ink m-2 rounded-lg border p-3 shadow-sm"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-ink truncate text-sm font-semibold">
          {metadata.author}
        </span>
        {metadata.pending === true && (
          <span className="text-ink-faint text-xs">Posting…</span>
        )}
        {metadata.htmlUrl != null && (
          <a
            href={metadata.htmlUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink-faint hover:text-accent text-xs underline"
          >
            On GitHub
          </a>
        )}
        <div className="ml-auto flex items-center gap-1">
          {clipped && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={anchor != null}
              onClick={open}
            >
              Expand
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            onClick={() => onDelete(itemId, metadata.key)}
          >
            Delete
          </Button>
        </div>
      </div>

      <div className="relative">
        <div
          ref={measureClipping}
          // A fixed height, not a maximum. The card measures the same whatever
          // the markdown turns out to be, and a late-loading image is clipped
          // rather than pushing the card taller.
          style={{ height: spec.bodyHeight }}
          className="overflow-hidden"
        >
          <CommentBody body={metadata.body} />
        </div>
        {clipped && (
          <button
            type="button"
            aria-label="Expand comment"
            onClick={open}
            className={cn(
              'absolute inset-x-0 bottom-0 h-8 cursor-pointer',
              'bg-gradient-to-t from-[var(--app-raised)] to-transparent'
            )}
          />
        )}
      </div>

      {metadata.error != null && (
        <p className="text-removed mt-2 text-xs">{metadata.error}</p>
      )}

      {anchor != null && (
        <CommentExpansion anchor={anchor} onClose={close}>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-ink text-sm font-semibold">
              {metadata.author}
            </span>
            {metadata.htmlUrl != null && (
              <a
                href={metadata.htmlUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-ink-faint hover:text-accent text-xs underline"
              >
                On GitHub
              </a>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={close}
            >
              Collapse
            </Button>
          </div>
          <CommentBody body={metadata.body} />
        </CommentExpansion>
      )}
    </div>
  );
}
