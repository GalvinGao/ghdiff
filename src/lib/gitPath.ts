// A path as git writes it into a patch header, turned back into the path.
//
// Git quotes a path that holds a byte outside printable ASCII, a `"` or a `\`:
// it wraps the path in double quotes and writes each such byte as a C escape,
// and with `core.quotePath` on — the default, and what github.com's `.diff`
// host runs with — every byte of a UTF-8 character becomes an octal escape. So
// `docs/プライバシー.md` arrives as `"docs/\343\203\227..."`, and a reader that
// takes the header at its word names the file in escapes.
//
// `@pierre/diffs` strips the quotes on a `diff --git` line and keeps the
// escapes, and keeps both on a `rename from` line. This reads either shape.

const SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  '\\': 0x5c,
};

const OCTAL_ESCAPE = /^[0-3][0-7]{2}$/;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The path a git patch header names, with git's quoting undone.
 *
 * A path git left unquoted holds no `\` at all, since a backslash is one of the
 * bytes that makes git quote. So a backslash in a name read off a git patch is
 * always the start of an escape, and a path with none comes back unchanged —
 * which is every path on most diffs, at the cost of one `includes`.
 *
 * The escapes are bytes, not characters: three octal escapes are one Japanese
 * character between them. They are gathered as bytes and decoded as UTF-8 once
 * at the end, and a sequence that is not UTF-8 decodes to replacement
 * characters rather than throwing. A backslash before anything git does not
 * write is kept as it stands.
 */
export function unquoteGitPath(path: string): string {
  const body =
    path.length >= 2 && path.startsWith('"') && path.endsWith('"')
      ? path.slice(1, -1)
      : path;
  if (!body.includes('\\')) return body;

  const bytes: number[] = [];
  let literalStart = 0;
  const flushLiteral = (end: number) => {
    if (end > literalStart) {
      bytes.push(...encoder.encode(body.slice(literalStart, end)));
    }
  };

  for (let index = 0; index < body.length; index++) {
    if (body[index] !== '\\') continue;
    const next = body[index + 1];
    if (next == null) break;

    const octal = body.slice(index + 1, index + 4);
    if (OCTAL_ESCAPE.test(octal)) {
      flushLiteral(index);
      bytes.push(Number.parseInt(octal, 8));
      index += 3;
      literalStart = index + 1;
      continue;
    }

    const simple = SIMPLE_ESCAPES[next];
    if (simple != null) {
      flushLiteral(index);
      bytes.push(simple);
      index += 1;
      literalStart = index + 1;
    }
  }
  flushLiteral(body.length);

  return decoder.decode(new Uint8Array(bytes));
}

/** Whether the patch is git's own format, which is the one that quotes. */
export function isGitPatch(patchContent: string): boolean {
  return /^diff --git /m.test(patchContent);
}

const QUOTE_ESCAPES: Readonly<Record<string, string>> = {
  '\x07': String.raw`\a`,
  '\b': String.raw`\b`,
  '\t': String.raw`\t`,
  '\n': String.raw`\n`,
  '\v': String.raw`\v`,
  '\f': String.raw`\f`,
  '\r': String.raw`\r`,
  '"': String.raw`\"`,
  '\\': String.raw`\\`,
};

// The bytes that make git quote, less the ones above 0x7f: those are left as
// UTF-8, which is `core.quotePath=false` and which the reader takes either way.
// oxlint-disable-next-line no-control-regex
const NEEDS_QUOTING = /["\\\x00-\x1f\x7f]/;
// oxlint-disable-next-line no-control-regex
const QUOTED_CHARACTER = /["\\\x00-\x1f\x7f]/g;

/**
 * A path written into a patch header the way git writes it, with its `a/` or
 * `b/` prefix: bare when nothing in it needs quoting, and quoted with C escapes
 * when something does. It is the inverse `unquoteGitPath` reads, for a patch
 * this app writes itself — a name holding a backslash written bare would be
 * read back as an escape.
 */
export function quoteGitPath(path: string, prefix = ''): string {
  if (!NEEDS_QUOTING.test(path)) return `${prefix}${path}`;
  const escaped = path.replace(
    QUOTED_CHARACTER,
    (character) =>
      QUOTE_ESCAPES[character] ??
      `\\${character.charCodeAt(0).toString(8).padStart(3, '0')}`
  );
  return `"${prefix}${escaped}"`;
}
