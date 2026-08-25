'use client';

import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/cn';

// GFM for comment bodies: tables, task lists, strikethrough, autolinks, fences.
//
// react-markdown does not render raw HTML unless rehype-raw is added, and it is
// deliberately absent. A comment body is written by whoever reviewed the pull
// request, so it is untrusted text and must never become markup.
//
// The component map is a module constant, and the whole render is memoized on
// the body string, so scrolling the diff past a comment costs no reparse.

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
  li: ({ children }) => <li className="my-0.5">{children}</li>,
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
  // A comment image is usually a badge. It is capped so one loading image
  // cannot push the body past the height its card already reserved.
  img: ({ alt, src }) => (
    <img
      alt={alt ?? ''}
      src={typeof src === 'string' ? src : undefined}
      loading="lazy"
      className="my-0.5 inline-block max-h-40 max-w-full align-middle"
    />
  ),
  input: ({ checked, type }) =>
    type === 'checkbox' ? (
      <input
        type="checkbox"
        checked={checked === true}
        readOnly
        className="mr-1 align-middle"
      />
    ) : null,
};

const PLUGINS = [remarkGfm];

export const CommentBody = memo(function CommentBody({
  body,
  className,
}: {
  body: string;
  className?: string;
}) {
  return (
    <div className={cn('text-sm leading-snug break-words', className)}>
      <Markdown components={COMPONENTS} remarkPlugins={PLUGINS}>
        {body}
      </Markdown>
    </div>
  );
});
