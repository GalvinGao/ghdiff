// Records the GitLab discussion and user responses that the comments tests
// in `src/lib/server/forges/gitlab.test.ts` replay through msw.
//
//   GITLAB_PERSONAL_ACCESS_TOKEN=glpat-… GITLAB_API_URL=https://host/api/v4 \
//     node test/fixtures/record/gitlab-discussions.mjs
//
// The source is a private, self-hosted instance, so what it answers is
// anonymized on the way out: the bodies, the usernames, the avatars, the
// file paths, and the instance's own ids — project, merge-request and user.
// What is kept is the contract the forge reads: the note `type`s, the
// `system` flag, the `position` shapes (including both `line_range` edge
// cases the instance produces), `resolvable`/`resolved`, the restricted
// author object with no `bot` field on it, and the full user objects that do
// carry one. A note's id and its discussion's id stay: the tests address the
// notes by them, and without the host they name nothing.
//
// Everything private the recording needs lives in
// `gitlab-discussions.local.json` beside this script, gitignored so the
// de-anonymization key is never committed; the committed `.example` shows the
// shape. It names, with the instance's real values:
//   mergeRequests  the discussions to record — project, iid, the fixture
//                  file to write, and an optional `wanted` list of
//                  discussion-id prefixes to keep out of the page
//   users          the user objects to record — id and the fixture file
//   usernames      real username → the pseudonym the fixture carries
// A username with no pseudonym stops the recording rather than passing
// through. The arrays are ordered: each kind of id gets a sequential
// stand-in on first encounter, so the order is what reproduces the committed
// fixtures, and the bot's merge request comes first because its project is
// stand-in 1000, the number the fabricated `project_1000_bot_…` username
// embeds.
//
// The merge requests were chosen for the matrix they cover:
//   the bot file      a project access-token bot's whole-MR notes
//                     (`type: null`, a `project_…_bot_…` username).
//   the threads file  `DiscussionNote` review threads, a `DiffNote` thread
//                     with replies, every thread `resolved: true`, a
//                     single-line `line_range`, and one on a context line
//                     (`type: "expanded"`, both `old_line` and `new_line`
//                     set). System notes included to prove they are dropped.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const API = process.env.GITLAB_API_URL;
const TOKEN = process.env.GITLAB_PERSONAL_ACCESS_TOKEN;
if (API == null || TOKEN == null) {
  throw new Error('Set GITLAB_API_URL and GITLAB_PERSONAL_ACCESS_TOKEN.');
}

const OUT_DIR = new URL('../gitlab/', import.meta.url);

const local = JSON.parse(
  await readFile(
    new URL('gitlab-discussions.local.json', import.meta.url),
    'utf8'
  )
);
const USERNAMES = new Map(Object.entries(local.usernames ?? {}));

function pseudonymUsername(real) {
  const username = USERNAMES.get(real);
  if (username == null) {
    throw new Error(
      `No pseudonym for "${real}": add one to gitlab-discussions.local.json.`
    );
  }
  return username;
}

// A sequential stand-in per private id, assigned on first encounter — the
// same scheme as the file paths below.
function sequential(from, step = 1) {
  const seen = new Map();
  let count = 0;
  return (real) => {
    if (real == null) return real;
    if (!seen.has(real)) {
      seen.set(real, from + step * count++);
    }
    return seen.get(real);
  };
}
const pseudonymProjectId = sequential(1000, 1000);
const pseudonymNoteableId = sequential(5001);
const pseudonymNoteableIid = sequential(101);
const pseudonymUserId = sequential(11);

const PATHS = new Map();
let pathCount = 0;
function pseudonymPath(real) {
  if (!PATHS.has(real)) {
    PATHS.set(real, `src/file-${++pathCount}.ts`);
  }
  return PATHS.get(real);
}

function sanitizeAuthor(author) {
  if (author == null) return author;
  const username = pseudonymUsername(author.username);
  return {
    id: pseudonymUserId(author.id),
    username,
    public_email: null,
    name: username,
    state: author.state,
    locked: author.locked,
    avatar_url: '',
    web_url: '',
  };
}

/**
 * A line code is `sha1(path)_old_new`, so the source's own hash would name
 * the real path to anyone who guessed it. It is rehashed from the pseudonym,
 * which is also what an instance would have written for that path.
 */
function sanitizeLineCode(code, path) {
  if (typeof code !== 'string') return code;
  const hash = createHash('sha1').update(path).digest('hex');
  return code.replace(/^[0-9a-f]{40}(?=_)/, hash);
}

function sanitizeLineRange(range, path) {
  if (range == null) return range;
  const edge = (point) =>
    point == null
      ? point
      : { ...point, line_code: sanitizeLineCode(point.line_code, path) };
  return { ...range, start: edge(range.start), end: edge(range.end) };
}

function sanitizeNote(note) {
  const newPath =
    note.position == null ? undefined : pseudonymPath(note.position.new_path);
  const position =
    note.position == null
      ? undefined
      : {
          ...note.position,
          new_path: newPath,
          old_path: pseudonymPath(note.position.old_path),
          ...(note.position.line_range == null
            ? {}
            : {
                line_range: sanitizeLineRange(
                  note.position.line_range,
                  newPath
                ),
              }),
        };
  const sanitized = {
    ...note,
    body: '…',
    author: sanitizeAuthor(note.author),
    project_id: pseudonymProjectId(note.project_id),
    noteable_id: pseudonymNoteableId(note.noteable_id),
    noteable_iid: pseudonymNoteableIid(note.noteable_iid),
    ...(position == null ? {} : { position }),
  };
  // `resolved_by` names a real person and `suggestions` quotes the source's
  // own code; the forge reads neither.
  delete sanitized.resolved_by;
  delete sanitized.suggestions;
  return sanitized;
}

function sanitizeDiscussion(discussion) {
  return {
    ...discussion,
    notes: (discussion.notes ?? []).map(sanitizeNote),
  };
}

function sanitizeUser(user) {
  const username = pseudonymUsername(user.username);
  return {
    id: pseudonymUserId(user.id),
    username,
    public_email: null,
    name: username,
    state: user.state,
    locked: user.locked,
    avatar_url: '',
    web_url: '',
    bot: user.bot,
  };
}

async function get(path) {
  const response = await fetch(`${API}${path}`, {
    headers: { 'private-token': TOKEN, 'user-agent': 'ghdiff' },
  });
  if (!response.ok) {
    throw new Error(`${path}: ${response.status}`);
  }
  return response.json();
}

const files = {};
for (const mr of local.mergeRequests ?? []) {
  const page = await get(
    `/projects/${mr.project}/merge_requests/${mr.iid}/discussions?per_page=100`
  );
  let discussions = page;
  if (mr.wanted != null) {
    discussions = page.filter((discussion) =>
      mr.wanted.some((wanted) => discussion.id.startsWith(wanted))
    );
    if (discussions.length !== mr.wanted.length) {
      throw new Error(
        `Expected ${mr.wanted.length} discussions on !${mr.iid}, found ${discussions.length}.`
      );
    }
  }
  files[mr.file] = discussions.map(sanitizeDiscussion);
}
for (const user of local.users ?? []) {
  files[user.file] = sanitizeUser(await get(`/users/${user.id}`));
}

for (const [file, data] of Object.entries(files)) {
  await writeFile(new URL(file, OUT_DIR), `${JSON.stringify(data, null, 2)}\n`);
  console.log('wrote', file);
}
