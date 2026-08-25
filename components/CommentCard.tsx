'use client';

import { Button } from '@/components/ui/Button';
import { type CommentMetadata, isSavedComment } from '@/lib/comments';

interface CommentCardProps {
  itemId: string;
  metadata: CommentMetadata;
  onDelete(itemId: string, key: string): void;
}

export function CommentCard({ itemId, metadata, onDelete }: CommentCardProps) {
  if (!isSavedComment(metadata)) return null;

  return (
    <div className="border-line bg-raised text-ink m-2 rounded-lg border p-3 text-sm shadow-sm">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-ink font-semibold">{metadata.author}</span>
        {metadata.pending === true && (
          <span className="text-ink-faint text-xs">Posting…</span>
        )}
        {metadata.htmlUrl != null && (
          <a
            href={metadata.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="text-ink-faint hover:text-accent text-xs underline"
          >
            On GitHub
          </a>
        )}
        <Button
          variant="danger"
          size="sm"
          className="ml-auto"
          onClick={() => onDelete(itemId, metadata.key)}
        >
          Delete
        </Button>
      </div>
      <p className="whitespace-pre-wrap">{metadata.body}</p>
      {metadata.error != null && (
        <p className="text-removed mt-2 text-xs">{metadata.error}</p>
      )}
    </div>
  );
}
