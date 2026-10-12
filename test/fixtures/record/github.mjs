// Records the real, anonymous-readable GitHub responses that the forge tests
// in `src/lib/server/forges/github.test.ts` replay through msw.
//
//   node test/fixtures/record/github.mjs
//
// Everything here is fetched without a credential, which is why the GraphQL
// answers in the test file are hand-shaped instead: api.github.com/graphql
// refuses an anonymous caller outright. Every request names
// `user-agent: ghdiff`, because GitHub answers a header-less one with 403.
//
// The targets, and why each was chosen:
//   ghostty-org/ghostty       a busy repository with real open pull requests
//   ghostty-org/ghostty#14052 an open pull request with six review comments —
//                             three replies and one whose `line` fell out of
//                             the diff (`line: null`, `original_line` set)
//   GalvinGao/ghdiff#6        a pull request whose files page is small
//   GalvinGao/ghdiff#13       a pull request whose .diff is a few kilobytes
//   GalvinGao/ghdiff main     two adjacent commits, for a small compare JSON

import { recordAll } from './lib.mjs';

const OUT_DIR = new URL('../github/', import.meta.url);

const API = 'https://api.github.com';
const JSON_HEADERS = {
  accept: 'application/vnd.github+json',
  'user-agent': 'ghdiff',
};

/** @type {import('./lib.mjs').Source[]} */
const SOURCES = [
  {
    file: 'pulls.json',
    url: `${API}/repos/ghostty-org/ghostty/pulls?state=open&sort=updated&direction=desc&per_page=5`,
    status: 200,
    kind: 'json',
  },
  {
    file: 'pull.json',
    url: `${API}/repos/ghostty-org/ghostty/pulls/14052`,
    status: 200,
    kind: 'json',
  },
  {
    file: 'pull-comments.json',
    url: `${API}/repos/ghostty-org/ghostty/pulls/14052/comments?per_page=100`,
    status: 200,
    kind: 'json',
  },
  {
    file: 'pull-files.json',
    url: `${API}/repos/GalvinGao/ghdiff/pulls/6/files?per_page=5&page=1`,
    status: 200,
    kind: 'json',
  },
  {
    file: 'compare.json',
    url: `${API}/repos/GalvinGao/ghdiff/compare/3756360521e239afdc7145f36ef20d204f5204cf...9054b5d751e6ad9ae2b09e3ff759d51c8aad3b91`,
    status: 200,
    kind: 'json',
  },
  {
    file: 'pull.diff',
    url: 'https://github.com/GalvinGao/ghdiff/pull/13.diff',
    status: 200,
    kind: 'text',
  },
  {
    // The one failure that is anonymous-readable on purpose: a bad token.
    file: 'user-401.json',
    url: `${API}/user`,
    status: 401,
    kind: 'json',
    headers: { ...JSON_HEADERS, authorization: 'Bearer not-a-real-token' },
  },
];

await recordAll({
  outDir: OUT_DIR,
  sources: SOURCES,
  headers: JSON_HEADERS,
  note: 'Anonymous reads of public repositories; see record/github.mjs.',
});
