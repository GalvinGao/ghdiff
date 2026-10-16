// Records the real, anonymous-readable GitLab responses that the forge tests
// in `src/lib/server/forges/gitlab.test.ts` replay through msw.
//
//   node test/fixtures/record/gitlab.mjs
//
// Everything here is fetched without a credential against gitlab.com. Every
// request names `user-agent: ghdiff`, the header the forge's hand-rolled
// calls send.
//
// The target, and why it was chosen:
//   gitlab-org/gitlab-vscode-extension   a public project whose !3334
//                                        ("chore: replace Babel with esbuild",
//                                        merged) is a seven-file diff with an
//                                        added file and a deleted one, small
//                                        enough for a readable fixture. Its
//                                        head sha ee095772 answers the commit
//                                        diff, and 925c5a41...ee095772 the
//                                        compare.

import { recordAll } from './lib.mjs';

const OUT_DIR = new URL('../gitlab/', import.meta.url);

const PROJECT = 'gitlab-org%2Fgitlab-vscode-extension';
const API = `https://gitlab.com/api/v4/projects/${PROJECT}`;
const HEAD_SHA = 'ee095772260696052b74058d58bb7adf2b1aead9';

const HEADERS = { 'user-agent': 'ghdiff' };

/** @type {import('./lib.mjs').Source[]} */
const SOURCES = [
  {
    file: 'mr-show.json',
    url: `${API}/merge_requests/3334`,
    status: 200,
    kind: 'json',
  },
  {
    file: 'mr-diffs.json',
    url: `${API}/merge_requests/3334/diffs?per_page=100&page=1`,
    status: 200,
    kind: 'json',
  },
  {
    // Five of the project's open merge requests: a small page keeps the
    // fixture readable, and the page includes a draft. The forge's own query
    // (per_page=100, order_by=updated_at) is asserted off the recorded
    // request, not off this body.
    file: 'mr-list.json',
    url: `${API}/merge_requests?state=opened&per_page=5&page=1`,
    status: 200,
    kind: 'json',
  },
  {
    file: 'mr-raw-diffs.diff',
    url: `${API}/merge_requests/3334/raw_diffs`,
    status: 200,
    kind: 'text',
  },
  {
    file: 'commit-diff.json',
    url: `${API}/repository/commits/${HEAD_SHA}/diff?per_page=100`,
    status: 200,
    kind: 'json',
  },
  {
    file: 'compare.json',
    url: `${API}/repository/compare?from=925c5a41&to=${HEAD_SHA}`,
    status: 200,
    kind: 'json',
  },
  {
    file: 'file.txt',
    url: `${API}/repository/files/.eslintrc.json/raw?ref=${HEAD_SHA}`,
    status: 200,
    kind: 'text',
  },
  {
    // An MR's approval state is anonymous-readable on a public project. The
    // discussions beside it are not — they answer 401 without a token, so
    // the test shapes those by hand.
    file: 'approval-state.json',
    url: `${API}/merge_requests/3334/approval_state`,
    status: 200,
    kind: 'json',
  },
  {
    // The failure GitLab answers for a project that is absent or invisible:
    // it deliberately does not tell the two apart.
    file: 'project-404.json',
    url: 'https://gitlab.com/api/v4/projects/ghdiff-bogus%2Fnope',
    status: 404,
    kind: 'json',
  },
  {
    // `/user` names the credential's own user, so anonymously it only ever
    // answers this 401 — which is the one answer recordable without one.
    file: 'user-401.json',
    url: 'https://gitlab.com/api/v4/user',
    status: 401,
    kind: 'json',
  },
];

await recordAll({
  outDir: OUT_DIR,
  sources: SOURCES,
  headers: HEADERS,
  // A spent quota answers 429 and deserves another attempt.
  retryOn: (status) => status === 429,
  // The discussions and users recorded by record/gitlab-discussions.mjs carry
  // over in the manifest; this script did not record them.
  keepUnrecorded: true,
  note: 'Anonymous reads of a public gitlab.com project; see record/gitlab.mjs.',
});
