import { Link } from '@tanstack/react-router';

import { useAppData } from '@/components/AppDataProvider';
import { exampleDisplayPath } from '@/lib/exampleTargets';
import { m } from '@/paraglide/messages.js';

/**
 * Diffs to open when there is nothing of your own to review yet.
 *
 * Each row is the path itself, which is the one thing the two lines above the
 * card just taught the reader to write. A title over a description of the
 * target said neither: it named a pull request nobody had heard of, and then
 * spelled the target as `owner/repo #123`, which is not what anybody types.
 *
 * The right edge keeps the size, because the size is the reason to pick one row
 * over another. A reviewer who wants to see what the surface does with 2,188
 * files should not have to open three of them to find it.
 *
 * The rows arrive with the page, narrowed server-side to the hosts this
 * deployment serves — an example that cannot open is a broken link with a
 * story, so a host this ghdiff does not answer for has no rows here at all.
 */
export function ExampleTargets() {
  const { instance } = useAppData();
  return (
    <ul className="font-mono text-xs">
      {instance.examples.map((group) =>
        group.rows.map((row) => (
          <li key={`${group.host}:${row.path}`}>
            <Link
              to="/$"
              params={{ _splat: `${group.host}:${row.path}` }}
              // `surface` and not `raised`: the card this list sits in is
              // `raised` itself, so a row that hovered to `raised` hovered to
              // the colour already under it and nothing happened. This is the
              // same pair the `outline` button uses, for the same reason.
              className="group hover:bg-surface focus-visible:bg-surface flex items-baseline gap-3 rounded-md px-2 py-1.5 outline-none"
              title={m.example_targets_label({
                title: row.title,
                note: row.note,
              })}
            >
              <span className="text-ink min-w-0 flex-1 truncate" dir="ltr">
                <span className="text-ink-faint">/</span>
                {group.host}:{exampleDisplayPath(row)}
              </span>
              {/* The tone lifts with the row. `raised` and `surface` are eight
                  values apart, which is the whole distance this app has between
                  a card and the page under it, so the background alone is a
                  hover a reader can miss. The figures moving with it is what
                  makes the row answer the pointer. */}
              <span className="text-ink-faint group-hover:text-ink-muted group-focus-visible:text-ink-muted shrink-0 text-[11px] tabular-nums transition-colors">
                {row.scale}
              </span>
            </Link>
          </li>
        ))
      )}
    </ul>
  );
}
