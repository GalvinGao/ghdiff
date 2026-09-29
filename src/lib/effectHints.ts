import type { FileDiffMetadata } from '@pierre/diffs';

// What an Effect program says between the `yield*`s.
//
// Effect code written with `Effect.gen` puts `yield*` in front of nearly every
// line, and it means one thing each time: run this effect, take its value, and
// leave the generator the moment it fails. That is Go's `if err != nil { return
// err }`, spelled with six characters per line instead of three, and an editor
// that knows Go quiets the one and labels where it actually exits. This module
// does the same reading for a diff: it finds every `yield*` so the viewer can
// dim it, and it names the few lines whose meaning the keyword hides — the ones
// that fail on purpose, the ones that die, the ones that reach for a service,
// and the ones that catch.
//
// A diff is not a program, so none of this is a parser. A hunk starts and ends
// wherever git's context ran out: halfway through a call, inside an object
// literal, with a closing brace whose opener is forty lines up and off screen.
// A real syntax tree over that text is a tree of error nodes. So the reading
// here is an island parse. A small tokenizer turns each contiguous run of lines
// into words, strings and punctuation — it knows comments, the three kinds of
// string and a regular expression, because those are what would otherwise put
// a `yield*` where there is none — and a handful of recognizers look for the
// shapes above and ignore everything else. An unmatched bracket costs nothing,
// because nothing here needs the brackets to balance: a call whose closing
// parenthesis is past the end of the hunk is read up to the end of the hunk.
//
// The runs are the hunks until the file has been hydrated, and the whole file
// after. So the reading gets better when a reviewer expands a file, and a
// multi-line `Effect.fail(` whose argument sat in the collapsed region is named
// once its lines arrive.
//
// Everything is gated on the file: a JavaScript or TypeScript path that names
// `Effect` somewhere in the lines the diff holds. `yield*` is a plain
// JavaScript operator and a redux-saga file is full of it, and calling a
// PascalCase operand a service there would be a wrong sentence on every line.

/** A run of columns on one line, end exclusive. */
export interface ColumnSpan {
  start: number;
  end: number;
}

/**
 * A stretch of one line that a label is drawn in place of, until the reviewer
 * opens it. Always one line: the viewer lays a diff out one row per line, and
 * a fold across rows would be a row the virtualizer and the other column of a
 * split view both still count.
 */
export interface EffectFold extends ColumnSpan {
  label: string;
  /** The reading as a sentence, then the code the fold is hiding. */
  title: string;
}

/** What one line of an Effect program is shown with. */
export interface EffectLineHint {
  /** Where `yield*` sits on the line, to be drawn quieter. */
  yields: ColumnSpan[];
  /** Expressions drawn as their label, sorted and never overlapping. */
  folds: EffectFold[];
  /** A few words drawn after the code, for a reading whose expression runs
      onto another line and so cannot fold. */
  label?: string;
  /** The same reading as a sentence, for the row's tooltip. */
  title?: string;
}

export type EffectLineHints = Map<number, EffectLineHint>;

export interface EffectHints {
  /** By old-side line number. */
  deletions: EffectLineHints;
  /** By new-side line number, context lines included. */
  additions: EffectLineHints;
}

/** The subset of a file diff this module reads. */
export type EffectHintsSource = Pick<
  FileDiffMetadata,
  | 'name'
  | 'prevName'
  | 'hunks'
  | 'deletionLines'
  | 'additionLines'
  | 'isPartial'
>;

const SCRIPT_PATH = /\.[cm]?[jt]sx?$/i;
const MENTIONS_EFFECT = /\bEffect\b|from\s*["'](?:effect|@effect\/)/;

/**
 * The hints for one file, or nothing when the file is not Effect code or has
 * nothing to show — which is most files.
 */
export function findEffectHints(
  fileDiff: EffectHintsSource
): EffectHints | undefined {
  const scriptNew = SCRIPT_PATH.test(fileDiff.name);
  const scriptOld = SCRIPT_PATH.test(fileDiff.prevName ?? fileDiff.name);
  if (!scriptNew && !scriptOld) return undefined;
  if (
    !fileDiff.additionLines.some((line) => MENTIONS_EFFECT.test(line)) &&
    !fileDiff.deletionLines.some((line) => MENTIONS_EFFECT.test(line))
  ) {
    return undefined;
  }

  const hints: EffectHints = { deletions: new Map(), additions: new Map() };
  if (scriptOld) {
    for (const run of sideRuns(fileDiff, 'deletion')) {
      scanEffectRun(run.lines, run.firstLine, hints.deletions);
    }
  }
  if (scriptNew) {
    for (const run of sideRuns(fileDiff, 'addition')) {
      scanEffectRun(run.lines, run.firstLine, hints.additions);
    }
  }
  return hints.deletions.size > 0 || hints.additions.size > 0
    ? hints
    : undefined;
}

interface Run {
  lines: readonly string[];
  firstLine: number;
}

/**
 * The contiguous stretches of one side's text. A partial file holds only the
 * patch's own lines, so each hunk is a stretch of its own and the gap between
 * two of them is text nobody has; a hydrated file is one stretch.
 */
function sideRuns(
  fileDiff: EffectHintsSource,
  side: 'deletion' | 'addition'
): Run[] {
  const lines =
    side === 'deletion' ? fileDiff.deletionLines : fileDiff.additionLines;
  if (!fileDiff.isPartial) return [{ lines, firstLine: 1 }];
  return fileDiff.hunks.map((hunk) => {
    const index =
      side === 'deletion' ? hunk.deletionLineIndex : hunk.additionLineIndex;
    const count = side === 'deletion' ? hunk.deletionCount : hunk.additionCount;
    const start = side === 'deletion' ? hunk.deletionStart : hunk.additionStart;
    return { lines: lines.slice(index, index + count), firstLine: start };
  });
}

// ---------------------------------------------------------------------------
// The tokenizer.

type TokenKind = 'word' | 'string' | 'punct';

interface Token {
  kind: TokenKind;
  /** The word, the punctuation character, or a string's contents. */
  text: string;
  /** Index of the line within the run. */
  line: number;
  start: number;
  end: number;
}

/** Words after which a `/` opens a regular expression rather than divides. */
const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'yield',
  'await',
]);

/** Punctuation after which a `/` divides: the end of an operand. */
const DIVIDE_AFTER_PUNCT = new Set([')', ']', '}']);

const WORD_START = /[A-Za-z_$]/;
const WORD_PART = /[\w$]/;

/** A frame of the tokenizer's stack: code, or the inside of a template. */
type Frame = { mode: 'code'; braces: number } | { mode: 'template' };

/**
 * Words, strings and punctuation, in order, over a run of lines. Comments are
 * dropped. A template literal is one string token with no contents, and the
 * code inside its `${}` is tokenized like any other.
 *
 * Tolerant at both ends. A run that opens on a JSDoc continuation line — a
 * hunk that starts inside a block comment — is read as comment up to its
 * `*\/`. A string, comment or template still open when the run ends simply
 * ends there.
 */
export function tokenize(lines: readonly string[]): Token[] {
  const tokens: Token[] = [];
  const stack: Frame[] = [{ mode: 'code', braces: 0 }];
  let inBlockComment = startsInsideComment(lines);

  const previous = () => tokens[tokens.length - 1];
  const regexCanStart = () => {
    const last = previous();
    if (last == null) return true;
    if (last.kind === 'string') return false;
    if (last.kind === 'word') return REGEX_AFTER_WORD.has(last.text);
    return !DIVIDE_AFTER_PUNCT.has(last.text);
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const text = lines[lineIndex]!;
    let column = 0;
    while (column < text.length) {
      if (inBlockComment) {
        const close = text.indexOf('*/', column);
        if (close < 0) break;
        inBlockComment = false;
        column = close + 2;
        continue;
      }

      const frame = stack[stack.length - 1]!;
      const char = text[column]!;

      if (frame.mode === 'template') {
        if (char === '\\') {
          column += 2;
        } else if (char === '`') {
          stack.pop();
          column += 1;
        } else if (char === '$' && text[column + 1] === '{') {
          stack.push({ mode: 'code', braces: 0 });
          column += 2;
        } else {
          column += 1;
        }
        continue;
      }

      if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
        column += 1;
        continue;
      }

      if (char === '/' && text[column + 1] === '/') break;
      if (char === '/' && text[column + 1] === '*') {
        inBlockComment = true;
        column += 2;
        continue;
      }

      if (char === '"' || char === "'") {
        const end = closeQuote(text, column, char);
        tokens.push({
          kind: 'string',
          text: text.slice(column + 1, Math.max(column + 1, end - 1)),
          line: lineIndex,
          start: column,
          end,
        });
        column = end;
        continue;
      }

      if (char === '`') {
        tokens.push({
          kind: 'string',
          text: '',
          line: lineIndex,
          start: column,
          end: column + 1,
        });
        stack.push({ mode: 'template' });
        column += 1;
        continue;
      }

      if (char === '/' && regexCanStart()) {
        const end = closeRegex(text, column);
        tokens.push({
          kind: 'string',
          text: '',
          line: lineIndex,
          start: column,
          end,
        });
        column = end;
        continue;
      }

      if (WORD_START.test(char)) {
        let end = column + 1;
        while (end < text.length && WORD_PART.test(text[end]!)) end += 1;
        tokens.push({
          kind: 'word',
          text: text.slice(column, end),
          line: lineIndex,
          start: column,
          end,
        });
        column = end;
        continue;
      }

      if (char >= '0' && char <= '9') {
        let end = column + 1;
        while (end < text.length && /[\w.]/.test(text[end]!)) end += 1;
        tokens.push({
          kind: 'word',
          text: text.slice(column, end),
          line: lineIndex,
          start: column,
          end,
        });
        column = end;
        continue;
      }

      // Braces are what carry a template's `${}` back out to the template.
      if (char === '{') frame.braces += 1;
      if (char === '}') {
        if (frame.braces === 0 && stack.length > 1) {
          stack.pop();
          column += 1;
          continue;
        }
        frame.braces = Math.max(0, frame.braces - 1);
      }
      tokens.push({
        kind: 'punct',
        text: char,
        line: lineIndex,
        start: column,
        end: column + 1,
      });
      column += 1;
    }
  }
  return tokens;
}

/**
 * Whether a run opens inside a block comment it cannot see the start of. Only
 * the one shape that says so is trusted — a first line that reads as the body
 * of a JSDoc block — because a stray `*\/` is also what a glob in a string
 * looks like, and `"**\/*.ts"` must stay code.
 */
function startsInsideComment(lines: readonly string[]): boolean {
  const first = lines.find((line) => line.trim() !== '');
  if (first == null) return false;
  const trimmed = first.trimStart();
  return (
    trimmed.startsWith('*/') ||
    (trimmed.startsWith('*') &&
      !trimmed.startsWith('**') &&
      !trimmed.startsWith('*='))
  );
}

/** The column after a quoted string's closing quote, or the line's end. */
function closeQuote(text: string, open: number, quote: string): number {
  for (let column = open + 1; column < text.length; column++) {
    const char = text[column];
    if (char === '\\') column += 1;
    else if (char === quote) return column + 1;
  }
  return text.length;
}

/** The column after a regular expression's flags, or the line's end. */
function closeRegex(text: string, open: number): number {
  let inClass = false;
  for (let column = open + 1; column < text.length; column++) {
    const char = text[column];
    if (char === '\\') column += 1;
    else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) {
      let end = column + 1;
      while (end < text.length && /[a-z]/i.test(text[end]!)) end += 1;
      return end;
    }
  }
  return text.length;
}

// ---------------------------------------------------------------------------
// The recognizers.

/** How far a recognizer reads into a call before it gives up looking. */
const ARGUMENT_WINDOW = 64;

const PASCAL_CASE = /^[A-Z][A-Za-z0-9_$]*$/;

/** Between two readings on one line, which is rare: `yield* Effect.fail(…)`
    inside a `catchTag` written on a single line. */
const LABEL_SEPARATOR = '   ';

interface Reading {
  label: string;
  title: string;
}

/**
 * The three ways a program ends on purpose. Each reads two ways: behind a
 * `yield*` it is where the generator leaves, which is what the arrow says, as
 * GoLand's `: err ↗` does; anywhere else — a ternary inside a callback, an
 * argument to `flatMap` — it is only a value that will fail when something
 * runs it, and claiming an exit there would be wrong.
 */
function fails(name: string | undefined, yielded: boolean): Reading {
  const what = name == null ? '' : ` · ${name}`;
  const withName = name == null ? '' : ` with ${name}`;
  return yielded
    ? { label: `fails${what} ↗`, title: `Stops here and fails${withName}.` }
    : { label: `fails${what}`, title: `Makes a failure${withName}.` };
}

function dies(yielded: boolean): Reading {
  return yielded
    ? {
        label: 'dies ↗',
        title: 'Stops here with a defect. Only a cause handler can see it.',
      }
    : {
        label: 'dies',
        title: 'Makes a defect. Only a cause handler can see it.',
      };
}

function interrupts(yielded: boolean): Reading {
  return yielded
    ? { label: 'interrupts ↗', title: 'Stops here and interrupts the fiber.' }
    : { label: 'interrupts', title: 'Makes an interruption.' };
}

const CATCHES_ALL: Reading = {
  label: 'catches all',
  title: 'Handles every expected failure above it.',
};

const CATCHES_SOME: Reading = {
  label: 'catches some',
  title: 'Handles the failures its predicate picks. The rest pass through.',
};

const OR_DIE: Reading = {
  label: 'failure → defect',
  title: 'Turns any failure above it into a defect.',
};

function catches(tags: readonly string[]): Reading {
  if (tags.length === 0) {
    return { label: 'catches', title: 'Handles failures by tag.' };
  }
  return {
    label: `catches · ${tags.join(', ')}`,
    title: `Handles ${tags.join(', ')}. Other failures pass through.`,
  };
}

function needs(name: string): Reading {
  return {
    label: `needs · ${name}`,
    title: `Reads the ${name} service. Something must provide it before this runs.`,
  };
}

/** The longest stretch of hidden code a fold's tooltip quotes. */
const TITLE_SOURCE_LIMIT = 160;

/** A reading, where its expression starts, and where it ends if one line
    holds the whole of it. */
interface Found {
  reading: Reading;
  start: number;
  end: number | undefined;
}

/**
 * Reads one run and adds what it finds to `into`, keyed by line number.
 * Exported for the tests, which hand it lines without a patch around them.
 */
export function scanEffectRun(
  lines: readonly string[],
  firstLine: number,
  into: EffectLineHints
): void {
  const tokens = tokenize(lines);
  const found = new Map<number, Found[]>();
  const yields = new Map<number, ColumnSpan[]>();

  const isPunct = (index: number, text: string) =>
    tokens[index]?.kind === 'punct' && tokens[index]!.text === text;
  const isWord = (index: number, text?: string) =>
    tokens[index]?.kind === 'word' &&
    (text == null || tokens[index]!.text === text);

  /**
   * Records a reading whose expression runs from token `from` to token
   * `last`, which is undefined when the expression's end is past the run.
   */
  const record = (reading: Reading, from: number, last: number | undefined) => {
    const head = tokens[from]!;
    const tail = last == null ? undefined : tokens[last];
    const entry: Found = {
      reading,
      start: head.start,
      end: tail?.line === head.line ? tail.end : undefined,
    };
    const list = found.get(head.line);
    if (list == null) found.set(head.line, [entry]);
    else list.push(entry);
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind !== 'word') continue;

    if (token.text === 'yield' && isPunct(index + 1, '*')) {
      const star = tokens[index + 1]!;
      const span = {
        start: token.start,
        end: star.line === token.line ? star.end : token.end,
      };
      const list = yields.get(token.line);
      if (list == null) yields.set(token.line, [span]);
      else list.push(span);
      const operand = readYieldOperand(tokens, index + 2, isPunct, isWord);
      if (operand != null) {
        // `new X(…)` ends at its own parenthesis, a service at its name.
        const name = isWord(index + 2, 'new') ? index + 3 : index + 2;
        record(operand, index, expressionEnd(tokens, name, isPunct));
      }
      continue;
    }

    if (
      token.text === 'Effect' &&
      isPunct(index + 1, '.') &&
      isWord(index + 2)
    ) {
      const reading = readEffectMember(tokens, index + 2, isPunct, isWord);
      if (reading == null) continue;
      // Behind a `yield*` the keyword folds with the call, so the label
      // stands where the keyword stood.
      const yielded = isPunct(index - 1, '*') && isWord(index - 2, 'yield');
      record(
        reading,
        yielded ? index - 2 : index,
        expressionEnd(tokens, index + 2, isPunct)
      );
    }
  }

  const lineIndices = new Set([...found.keys(), ...yields.keys()]);
  for (const lineIndex of lineIndices) {
    const hint: EffectLineHint = {
      yields: yields.get(lineIndex) ?? [],
      folds: [],
    };
    const entries = (found.get(lineIndex) ?? []).sort(
      (a, b) => a.start - b.start || (b.end ?? 0) - (a.end ?? 0)
    );
    // The outermost fold wins. A reading inside it is hidden with the code it
    // reads, and says so again the moment the fold is opened — as code.
    const inFold = (column: number) =>
      hint.folds.some((fold) => column >= fold.start && column < fold.end);
    for (const { reading, start, end } of entries) {
      if (inFold(start)) continue;
      if (end != null) {
        hint.folds.push({
          start,
          end,
          label: reading.label,
          title: `${reading.title}\n\n${quoteSource(lines[lineIndex]!.slice(start, end))}`,
        });
        continue;
      }
      if (hint.label?.split(LABEL_SEPARATOR).includes(reading.label)) continue;
      hint.label =
        hint.label == null
          ? reading.label
          : `${hint.label}${LABEL_SEPARATOR}${reading.label}`;
      hint.title =
        hint.title == null ? reading.title : `${hint.title}\n${reading.title}`;
    }
    into.set(firstLine + lineIndex, hint);
  }
}

function quoteSource(source: string): string {
  return source.length > TITLE_SOURCE_LIMIT
    ? `${source.slice(0, TITLE_SOURCE_LIMIT - 1)}…`
    : source;
}

/**
 * The last token of an expression whose name is the token at `name`: its own
 * closing parenthesis when it is called, or the name itself. Undefined when
 * the parenthesis is past the end of the run.
 */
function expressionEnd(
  tokens: readonly Token[],
  name: number,
  isPunct: IsPunct
): number | undefined {
  if (!isPunct(name + 1, '(')) return name;
  let depth = 0;
  for (let index = name + 1; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind !== 'punct') continue;
    if ('([{'.includes(token.text)) depth += 1;
    else if (')]}'.includes(token.text)) {
      depth -= 1;
      if (depth === 0) return token.text === ')' ? index : undefined;
    }
  }
  return undefined;
}

type IsPunct = (index: number, text: string) => boolean;
type IsWord = (index: number, text?: string) => boolean;

/**
 * What a `yield*` hands over, when that is one of the two shapes whose meaning
 * the keyword hides: a yieldable error made on the spot, which fails, or a
 * bare service tag, which reads the service out of the context. Anything else
 * is an ordinary effect run for its value, and says nothing more than the dim.
 */
function readYieldOperand(
  tokens: readonly Token[],
  index: number,
  isPunct: IsPunct,
  isWord: IsWord
): Reading | undefined {
  if (isWord(index, 'new') && isWord(index + 1)) {
    const name = tokens[index + 1]!.text;
    if (PASCAL_CASE.test(name)) return fails(name, true);
  }
  const operand = tokens[index];
  if (
    operand?.kind === 'word' &&
    operand.text !== 'Effect' &&
    PASCAL_CASE.test(operand.text) &&
    !isPunct(index + 1, '.') &&
    !isPunct(index + 1, '(') &&
    !isPunct(index + 1, '[') &&
    !isPunct(index + 1, '<') &&
    !isPunct(index + 1, '`')
  ) {
    return needs(operand.text);
  }
  return undefined;
}

/**
 * What `Effect.<member>` does, for the members that end a program or handle
 * one. `index` is the member's own token, and the four before it are read to
 * tell an exit from a value.
 */
function readEffectMember(
  tokens: readonly Token[],
  index: number,
  isPunct: IsPunct,
  isWord: IsWord
): Reading | undefined {
  // `yield* Effect.<member>`: the member, then `.`, `Effect`, `*`, `yield`.
  const yielded = isPunct(index - 3, '*') && isWord(index - 4, 'yield');
  const member = tokens[index]!.text;
  // Most members are functions, and handing one over uncalled —
  // `Effect.partition(values, Effect.fail)` — fails nothing and catches
  // nothing where it is written.
  if (isPunct(index + 1, '(')) {
    switch (member) {
      case 'fail':
      case 'failSync':
        return fails(errorNameIn(tokens, index + 2, isPunct, isWord), yielded);
      case 'die':
      case 'dieSync':
      case 'dieMessage':
        return dies(yielded);
      case 'catchTag':
        return catches(leadingStrings(tokens, index + 2, isPunct));
      case 'catchTags':
        return catches(
          isPunct(index + 2, '{') ? objectKeys(tokens, index + 3, isPunct) : []
        );
      case 'catchAll':
      case 'catchAllCause':
      case 'catch':
      case 'catchCause':
      case 'orElse':
        return CATCHES_ALL;
      case 'catchIf':
      case 'catchSome':
        return CATCHES_SOME;
    }
  }
  switch (member) {
    case 'interrupt':
      return interrupts(yielded);
    case 'orDie':
      return OR_DIE;
    default:
      return undefined;
  }
}

/**
 * The error a failure is made from, read out of its argument list: the class
 * after the first `new`, or the first PascalCase name called or reached into.
 * The list may run past the end of the run, so the read stops there, at its
 * own closing parenthesis, or after a window of tokens, whichever is first.
 */
function errorNameIn(
  tokens: readonly Token[],
  start: number,
  isPunct: IsPunct,
  isWord: IsWord
): string | undefined {
  let depth = 0;
  const end = Math.min(tokens.length, start + ARGUMENT_WINDOW);
  for (let index = start; index < end; index++) {
    if (isPunct(index, '(') || isPunct(index, '[') || isPunct(index, '{')) {
      depth += 1;
    } else if (
      isPunct(index, ')') ||
      isPunct(index, ']') ||
      isPunct(index, '}')
    ) {
      if (depth === 0) return undefined;
      depth -= 1;
    } else if (isWord(index, 'new') && isWord(index + 1)) {
      const name = tokens[index + 1]!.text;
      return PASCAL_CASE.test(name) ? name : undefined;
    } else if (
      isWord(index) &&
      PASCAL_CASE.test(tokens[index]!.text) &&
      (isPunct(index + 1, '(') || isPunct(index + 1, '.'))
    ) {
      return tokens[index]!.text;
    }
  }
  return undefined;
}

/** `"A", "B", …` at the start of an argument list: `catchTag`'s tags. */
function leadingStrings(
  tokens: readonly Token[],
  start: number,
  isPunct: IsPunct
): string[] {
  const tags: string[] = [];
  for (let index = start; tokens[index]?.kind === 'string'; index += 2) {
    const tag = tokens[index]!.text;
    if (tag !== '') tags.push(tag);
    if (!isPunct(index + 1, ',')) break;
  }
  return tags;
}

/**
 * The keys of an object literal whose `{` is just before `start`: the words
 * and strings followed by `:` at its own depth. `catchTags`' tags.
 */
function objectKeys(
  tokens: readonly Token[],
  start: number,
  isPunct: IsPunct
): string[] {
  const keys: string[] = [];
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind === 'punct') {
      if ('([{'.includes(token.text)) depth += 1;
      else if (')]}'.includes(token.text)) {
        if (depth === 0) break;
        depth -= 1;
      }
      continue;
    }
    if (depth === 0 && isPunct(index + 1, ':') && token.text !== '') {
      const previous = tokens[index - 1];
      if (
        previous == null ||
        index === start ||
        (previous.kind === 'punct' && previous.text === ',')
      ) {
        keys.push(token.text);
      }
    }
  }
  return keys;
}
