import { SectionLabel } from '@/components/ui/SectionLabel';
import { cn } from '@/lib/cn';
import {
  formatWatchedRepo,
  groupReposByOwner,
  type WatchedRepo,
} from '@/lib/pulls';

/**
 * Which watched repository the list beside this shows. The owner is said once,
 * as the heading of its group, and each row is the bare repository name: a
 * column of `owner/repo` reads as one long word repeated, and the part that
 * differs is the part at the end.
 *
 * The caller renders this only when there is more than one repository, because
 * with one there is nothing to switch between.
 */
export function RepoPicker({
  counts,
  onChange,
  repos,
  total,
  value,
}: {
  /**
   * Open pull requests per repository, keyed by a lower-case `owner/repo`.
   * Undefined until the first answer arrives: a `0` beside every repository
   * would say there are none, which is not what "not asked yet" means.
   */
  counts?: ReadonlyMap<string, number>;
  onChange(next: string | undefined): void;
  repos: readonly WatchedRepo[];
  total?: number;
  /** The selected `owner/repo`, or undefined for all of them. */
  value?: string;
}) {
  const groups = groupReposByOwner(repos);
  return (
    <nav aria-label="Watched repositories" className="flex flex-col gap-px">
      <PickerRow
        count={total}
        label="All repositories"
        selected={value == null}
        onSelect={() => onChange(undefined)}
      />
      {groups.map((group) => (
        <div key={group.owner} className="pt-2">
          <SectionLabel
            className="block truncate px-2 pb-1"
            title={group.owner}
          >
            {group.owner}
          </SectionLabel>
          {group.repos.map((repo) => {
            const key = formatWatchedRepo(repo);
            return (
              <PickerRow
                key={key}
                count={
                  counts?.get(key.toLowerCase()) ??
                  (counts == null ? undefined : 0)
                }
                label={repo.repo}
                selected={value?.toLowerCase() === key.toLowerCase()}
                onSelect={() => onChange(key)}
              />
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function PickerRow({
  count,
  label,
  onSelect,
  selected,
}: {
  count?: number;
  label: string;
  onSelect(): void;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-xs',
        'focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none',
        selected
          ? 'bg-surface text-ink font-medium'
          : 'text-ink-muted hover:bg-surface hover:text-ink'
      )}
      title={label}
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count == null ? (
        <span
          aria-hidden="true"
          className="bg-line/70 h-2 w-3 shrink-0 animate-pulse rounded motion-reduce:animate-none"
        />
      ) : (
        <span className="text-ink-faint shrink-0 tabular-nums">{count}</span>
      )}
    </button>
  );
}
