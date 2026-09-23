import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GrabberIcon } from '@primer/octicons-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tooltip } from '@/components/ui/Tooltip';
import type { WatchedReposState } from '@/hooks/useWatchedRepos';
import {
  formatWatchedRepo,
  watchedRepoKey,
  type WatchedRepo,
} from '@/lib/pulls';

/**
 * The watch list, and nothing around it: the dialog that shows this owns the
 * title and the way out. The list lives in this browser, so no server holds it.
 */
export function WatchedReposEditor({
  watched,
}: {
  watched: WatchedReposState;
}) {
  const id = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <div>
      <p className="text-ink-faint mb-2 text-xs">
        ghdiff lists open pull requests for these repositories. The list stays
        in this browser.
      </p>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (watched.add(input)) {
            setInput('');
            setError(undefined);
          } else {
            setError('Enter a repository as owner/repo.');
          }
        }}
      >
        <Input
          value={input}
          placeholder="owner/repo"
          aria-label="Repository to watch"
          onChange={(event) => setInput(event.target.value)}
        />
        <Button type="submit" variant="solid" size="md">
          Add
        </Button>
      </form>
      {error != null && <p className="text-removed mt-2 text-xs">{error}</p>}

      {watched.repos.length === 0 ? (
        <p className="text-ink-muted mt-3 text-sm">Nothing watched yet.</p>
      ) : (
        <DndContext
          id={id}
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={({ active, over }) => {
            if (over != null) watched.move(String(active.id), String(over.id));
          }}
        >
          <SortableContext
            items={watched.repos.map(watchedRepoKey)}
            strategy={verticalListSortingStrategy}
          >
            <ul
              aria-label="Watched repositories"
              className="mt-3 font-mono text-xs"
            >
              {watched.repos.map((repo) => (
                <SortableRepo
                  key={watchedRepoKey(repo)}
                  repo={repo}
                  onRemove={() => watched.remove(repo)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableRepo({
  repo,
  onRemove,
}: {
  repo: WatchedRepo;
  onRemove(): void;
}) {
  const name = formatWatchedRepo(repo);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: watchedRepoKey(repo) });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group hover:bg-surface focus-within:bg-surface relative flex items-center gap-3 rounded-md px-2 py-1.5 ${isDragging ? 'bg-surface z-10 shadow-sm' : ''}`}
    >
      <Tooltip label="Drag to reorder" side="right">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${name}`}
          className="text-ink-faint hover:text-ink focus-visible:text-ink focus-visible:outline-accent flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded active:cursor-grabbing"
        >
          <GrabberIcon size={16} />
        </button>
      </Tooltip>
      <span className="text-ink min-w-0 flex-1 truncate" title={name}>
        <span className="text-ink-faint">/</span>
        {name}
      </span>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className="text-ink-faint group-hover:text-ink-muted hover:text-removed focus-visible:text-removed focus-visible:outline-accent shrink-0 rounded px-1 py-1 text-[11px] transition-colors"
      >
        Remove
      </button>
    </li>
  );
}
