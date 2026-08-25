'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import type { DraftComment } from '@/lib/comments';

interface CommentComposerProps {
  itemId: string;
  metadata: DraftComment;
  onCancel(itemId: string, key: string): void;
  onSave(itemId: string, key: string, body: string): void;
}

export function CommentComposer({
  itemId,
  metadata,
  onCancel,
  onSave,
}: CommentComposerProps) {
  const [body, setBody] = useState(metadata.body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const canSave = body.trim().length > 0;
  const lineLabel =
    metadata.range.start === metadata.range.end
      ? `line ${metadata.range.end}`
      : `lines ${Math.min(metadata.range.start, metadata.range.end)} to ${Math.max(
          metadata.range.start,
          metadata.range.end
        )}`;

  return (
    <form
      className="border-accent/40 bg-raised m-2 rounded-lg border p-3 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSave(itemId, metadata.key, body);
      }}
    >
      <p className="text-ink-faint mb-1.5 text-xs">Comment on {lineLabel}</p>
      <textarea
        ref={textareaRef}
        value={body}
        rows={3}
        placeholder="Leave a comment"
        className="border-line bg-canvas text-ink placeholder:text-ink-faint focus-visible:border-accent w-full resize-y rounded-md border p-2 text-sm focus-visible:outline-none"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel(itemId, metadata.key);
            return;
          }
          // Cmd or Ctrl with Enter submits, which matches GitHub.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (canSave) onSave(itemId, metadata.key, body);
          }
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <Button type="submit" variant="solid" size="sm" disabled={!canSave}>
          Comment
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onCancel(itemId, metadata.key)}
        >
          Cancel
        </Button>
        <span className="text-ink-faint ml-auto text-[11px]">
          Cmd or Ctrl with Enter
        </span>
      </div>
    </form>
  );
}
