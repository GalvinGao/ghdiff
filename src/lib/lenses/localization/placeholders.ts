// The parts of a translated message a reviewer has to check by eye.
//
// A message is prose around placeholders, and the placeholders are the one part
// a translator must not translate: `{keyword}` in the English string has to
// arrive as `{keyword}` in the Japanese one, wherever the sentence moved it.
// Splitting a message into those two kinds of segment is what lets the panel
// draw the placeholder as a chip and what lets the checks compare two locales'
// sets of names without reading either language.
//
// Each syntax is a tokenizer and nothing else. None of them validates the
// message: a lone `{` in a sentence is text, because a checker that refused it
// would be guessing at the message format rather than reading it.

export type PlaceholderSyntax = 'braces' | 'double-braces' | 'printf';

export const PLACEHOLDER_SYNTAXES: readonly {
  id: PlaceholderSyntax;
  label: string;
  example: string;
}[] = [
  { id: 'braces', label: 'Single braces', example: '{name}' },
  { id: 'double-braces', label: 'Double braces', example: '{{name}}' },
  { id: 'printf', label: 'printf', example: '%s, %(name)s' },
];

export function isPlaceholderSyntax(
  value: unknown
): value is PlaceholderSyntax {
  return PLACEHOLDER_SYNTAXES.some((syntax) => syntax.id === value);
}

export type MessageSegment =
  | { type: 'text'; text: string }
  | {
      type: 'placeholder';
      /** The placeholder as written, braces and all. */
      text: string;
      /** What the checks compare across locales. */
      name: string;
    };

const IDENTIFIER = /^[A-Za-z_$][\w$.-]*$/;

export function tokenizeMessage(
  message: string,
  syntax: PlaceholderSyntax
): MessageSegment[] {
  switch (syntax) {
    case 'braces':
      return tokenizeBraces(message);
    case 'double-braces':
      return tokenizeRegex(message, /\{\{\s*([^{}]+?)\s*\}\}/g);
    case 'printf':
      return tokenizeRegex(
        message,
        /%(?:\(([A-Za-z_]\w*)\)|(\d+)\$)?[-+ 0#]*\d*(?:\.\d+)?[sdifuxXoeEgGc@]/g
      );
  }
}

/** The names a message uses, sorted, one entry per occurrence. */
export function placeholderNames(
  message: string,
  syntax: PlaceholderSyntax
): string[] {
  const names: string[] = [];
  for (const segment of tokenizeMessage(message, syntax)) {
    if (segment.type === 'placeholder') names.push(segment.name);
  }
  return names.sort();
}

/**
 * ICU and its relatives: `{name}`, and `{count, plural, one {…} other {…}}`,
 * whose inner branches hold braces of their own. The scan counts depth rather
 * than matching a pattern, so the whole plural is one placeholder named by its
 * argument, which is the part a translator must keep. Its branches are prose
 * and are left inside the chip rather than split out, because a checker that
 * compared branch text across languages would be comparing translations.
 */
function tokenizeBraces(message: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let text = '';
  let index = 0;
  while (index < message.length) {
    const char = message[index];
    if (char !== '{') {
      text += char;
      index += 1;
      continue;
    }
    const end = matchingBrace(message, index);
    const body = end == null ? undefined : message.slice(index + 1, end);
    const name = body?.split(',')[0]?.trim();
    if (end == null || name == null || !IDENTIFIER.test(name)) {
      text += char;
      index += 1;
      continue;
    }
    if (text.length > 0) segments.push({ type: 'text', text });
    text = '';
    segments.push({
      type: 'placeholder',
      text: message.slice(index, end + 1),
      name,
    });
    index = end + 1;
  }
  if (text.length > 0) segments.push({ type: 'text', text });
  return segments;
}

function matchingBrace(message: string, open: number): number | undefined {
  let depth = 0;
  for (let index = open; index < message.length; index++) {
    if (message[index] === '{') depth += 1;
    else if (message[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function tokenizeRegex(message: string, pattern: RegExp): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let last = 0;
  for (const match of message.matchAll(pattern)) {
    const start = match.index;
    if (start > last) {
      segments.push({ type: 'text', text: message.slice(last, start) });
    }
    // A printf directive without a name is named by its conversion, so `%s`
    // against `%d` still reads as a difference.
    const name = match[1] ?? match[2] ?? match[0];
    segments.push({ type: 'placeholder', text: match[0], name: name.trim() });
    last = start + match[0].length;
  }
  if (last < message.length) {
    segments.push({ type: 'text', text: message.slice(last) });
  }
  return segments;
}
