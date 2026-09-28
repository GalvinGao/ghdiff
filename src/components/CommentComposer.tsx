import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CheckBox } from '@/components/ui/CheckBox';
import type { DraftComment } from '@/lib/comments';

interface CommentComposerProps {
  /** Whether the note can be filed as an issue instead. */
  canCreateIssue: boolean;
  itemId: string;
  metadata: DraftComment;
  onCancel(itemId: string, key: string): void;
  onSave(itemId: string, key: string, body: string, createIssue: boolean): void;
}

export function CommentComposer({
  canCreateIssue,
  itemId,
  metadata,
  onCancel,
  onSave,
}: CommentComposerProps) {
  const [body, setBody] = useState(metadata.draftBody);
  // Off for every new composer. Most notes are comments, and an issue is a
  // thing other people see in another place, so it is asked for each time.
  const [asIssue, setAsIssue] = useState(false);
  const createIssue = canCreateIssue && asIssue;
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
      // Capped to match the thread card, so writing a comment and reading one
      // happen at the same measure.
      className="border-accent/40 bg-raised m-2 max-w-[42rem] rounded-lg border p-3 font-sans shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSave(itemId, metadata.key, body, createIssue);
      }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-ink-faint text-xs">Comment on {lineLabel}</p>
        {canCreateIssue && (
          <Button
            aria-pressed={createIssue}
            // The button's height and padding are its hover box and not its
            // text, so both are given back: the row stays one line of text
            // tall, and the label ends on the textarea's own right edge.
            className="-my-1.5 -mr-2 ml-auto"
            onClick={() => {
              setAsIssue((current) => !current);
              textareaRef.current?.focus();
            }}
            size="sm"
            title="Files this note as an issue with the lines in it, and leaves a link to it here."
            variant="quiet"
          >
            <CheckBox checked={createIssue} />
            Create issue
          </Button>
        )}
      </div>
      <textarea
        ref={textareaRef}
        value={body}
        rows={3}
        placeholder={
          createIssue ? 'What should the issue say?' : 'Leave a comment'
        }
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
            if (canSave) onSave(itemId, metadata.key, body, createIssue);
          }
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <Button type="submit" variant="solid" size="sm" disabled={!canSave}>
          {createIssue ? 'Create issue' : 'Comment'}
        </Button>
        <Button
          variant="quiet"
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
