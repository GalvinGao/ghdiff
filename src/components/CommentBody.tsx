import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/cn';

// GFM for comment bodies: tables, task lists, strikethrough, autolinks, fences.
//
// Raw HTML is parsed and then sanitized, in that order. GitHub's own editor
// writes HTML into bodies — an attached screenshot arrives as an `<img>` with a
// width, a release note as `<details>` — and dropping it left a description
// with holes where its pictures should be. So `rehype-raw` parses it and
// `rehype-sanitize` keeps only what its default schema permits.
//
// That schema is not ours to invent: it is hast-util-sanitize's, which follows
// GitHub's own sanitation. It allows `img`, `details`, `summary`, `kbd`, `sub`,
// the table elements, and the layout attributes; it drops `script` and `style`,
// every `on*` handler, `iframe`, `object`, and `embed`, and it holds `src` and
// `href` to http and https, so a `javascript:` URL cannot survive. A body is
// written by whoever reviewed the pull request, so nothing outside that list is
// trusted, and the list is not widened without a reason written down here.
//
// The component map is a module constant, and the whole render is memoized on
// the body string, so scrolling the diff past a comment costs no reparse.

function isTaskItem(className: string | undefined): boolean {
  return className != null && className.split(' ').includes('task-list-item');
}

// A `- [x]` in a body reaches this file as `<input type="checkbox" checked
// disabled>`, and a real control is the wrong answer to it twice over. The
// browser paints one in the platform's own blue, which is the single colour
// this app never uses, and it offers a press that can change nothing: the body
// belongs to GitHub, and ghdiff posts no edit of it. `disabled` settles the
// press alone and leaves the paint. So the box is drawn here instead, in the
// same tones the rest of a comment body uses — the fill of an inline code span,
// the line of a table's border — and it is an image, not a control.
//
// It carries no `<title>`: the box is one of many down a checklist, and a
// browser tooltip on each of them would follow the pointer across the whole
// description. `role="img"` with `aria-label` names the state for a screen
// reader and draws nothing.
function TaskMarker({ checked }: { checked: boolean }) {
  const label = checked ? 'Done' : 'Not done';
  return (
    <svg
      aria-label={label}
      className="mr-[0.4em] inline-block h-[1em] w-[1em] align-middle"
      data-task-marker=""
      role="img"
      viewBox="0 0 16 16"
    >
      <rect
        fill="var(--app-surface)"
        height={13}
        rx={3.5}
        stroke="var(--app-ink-faint)"
        width={13}
        x={1.5}
        y={1.5}
      />
      {checked && (
        <path
          d="M4.6 8.2 7 10.6l4.4-5"
          fill="none"
          stroke="var(--app-ink)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
        />
      )}
    </svg>
  );
}

const COMPONENTS: Components = {
  p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent underline underline-offset-2"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-1 list-disc pl-5 first:mt-0 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1 list-decimal pl-5 first:mt-0 last:mb-0">{children}</ol>
  ),
  // A task list item drops its bullet — the box `TaskMarker` draws is the one
  // marker it gets — and hangs that box in the bullet's own space, so its first
  // line and every wrapped line start on the list's own content edge. The pull
  // is stated here rather than on the marker, because a checkbox written as raw
  // HTML outside a list has no bullet lane to hang in.
  li: ({ children, className }) => (
    <li
      className={cn(
        'my-0.5',
        isTaskItem(className) && 'list-none [&_[data-task-marker]]:-ml-[1.4em]'
      )}
    >
      {children}
    </li>
  ),
  code: ({ className, children }) => {
    // react-markdown gives a fenced block a language class and puts it inside
    // <pre>; an inline span has neither.
    const isBlock = className != null && className.startsWith('language-');
    if (isBlock) {
      return <code className="font-mono text-[0.85em]">{children}</code>;
    }
    return (
      <code className="bg-surface rounded px-1 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-surface border-line my-1.5 overflow-x-auto rounded-md border p-2 first:mt-0 last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-line text-ink-muted my-1.5 border-l-2 pl-2.5">
      {children}
    </blockquote>
  ),
  h1: ({ children }) => <p className="mt-2 mb-1 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="mt-2 mb-1 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="mt-2 mb-1 font-semibold">{children}</p>,
  h4: ({ children }) => <p className="mt-2 mb-1 font-semibold">{children}</p>,
  h5: ({ children }) => <p className="mt-2 mb-1 font-semibold">{children}</p>,
  h6: ({ children }) => <p className="mt-2 mb-1 font-semibold">{children}</p>,
  hr: () => <hr className="border-line my-2" />,
  // Only reachable now that raw HTML is parsed. A release note or a long log is
  // usually folded into one of these, and the browser's default marker on our
  // own surface needs the same treatment as everything else here.
  details: ({ children }) => (
    <details className="border-line bg-surface my-1.5 rounded-md border px-2 py-1.5">
      {children}
    </details>
  ),
  summary: ({ children }) => (
    <summary className="cursor-pointer font-medium">{children}</summary>
  ),
  kbd: ({ children }) => (
    <kbd className="border-line bg-surface rounded border px-1 font-mono text-[0.85em]">
      {children}
    </kbd>
  ),
  table: ({ children }) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="border-line w-full border-collapse border text-[0.9em]">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-line bg-surface border px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-line border px-2 py-1">{children}</td>
  ),
  // Either a badge or a screenshot. The height is capped so the expanded thread
  // and the description stay scrollable rather than turning into one tall
  // picture; a collapsed card clips to its reserved height regardless, so a late
  // image cannot resize it. `width` and `height` from the markup are dropped:
  // GitHub writes the pixel width of the original, which is wider than any
  // surface here.
  img: ({ alt, src }) => (
    <img
      alt={alt ?? ''}
      src={typeof src === 'string' ? src : undefined}
      loading="lazy"
      className="border-line my-1 block max-h-80 max-w-full rounded border object-contain"
    />
  ),
  input: ({ checked, type }) =>
    type === 'checkbox' ? <TaskMarker checked={checked === true} /> : null,
};

const REMARK_PLUGINS = [remarkGfm];
// Order matters: raw parses the HTML, sanitize then throws away what is not on
// the schema. Reversing them would sanitize the text before the markup exists.
const REHYPE_PLUGINS = [rehypeRaw, rehypeSanitize];

export const CommentBody = memo(function CommentBody({
  body,
  className,
}: {
  body: string;
  className?: string;
}) {
  return (
    <div className={cn('text-sm leading-snug break-words', className)}>
      <Markdown
        components={COMPONENTS}
        rehypePlugins={REHYPE_PLUGINS}
        remarkPlugins={REMARK_PLUGINS}
      >
        {body}
      </Markdown>
    </div>
  );
});
