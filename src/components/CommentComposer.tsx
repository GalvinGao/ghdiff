import { useEffect, useRef, useState } from 'react';

import { m } from '../paraglide/messages.js';
import { getLocale } from '../paraglide/runtime.js';
import { Button } from '@/components/ui/Button';
import type { DraftComment } from '@/lib/comments';
import { textDirection } from '@/lib/locale';

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
  const [body, setBody] = useState(metadata.draftBody);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const canSave = body.trim().length > 0;
  const lineLabel =
    metadata.range.start === metadata.range.end
      ? m.comment_line({ line: metadata.range.end })
      : m.comment_line_range({
          start: Math.min(metadata.range.start, metadata.range.end),
          end: Math.max(metadata.range.start, metadata.range.end),
        });

  return (
    <form
      dir={textDirection(getLocale())}
      // Capped to match the thread card, so writing a comment and reading one
      // happen at the same measure.
      className="border-accent/40 bg-raised m-2 max-w-[42rem] rounded-lg border p-3 font-sans shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSave(itemId, metadata.key, body);
      }}
    >
      <p className="text-ink-faint mb-1.5 text-xs">{lineLabel}</p>
      <textarea
        dir="auto"
        ref={textareaRef}
        value={body}
        rows={3}
        placeholder={m.comment_composer_leave_a_comment()}
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
          {m.comment_composer_comment()}
        </Button>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => onCancel(itemId, metadata.key)}
        >
          {m.comment_composer_cancel()}
        </Button>
        <span className="text-ink-faint ml-auto text-[11px]">
          {m.comment_composer_cmd_or_ctrl_with_enter()}
        </span>
      </div>
    </form>
  );
}
