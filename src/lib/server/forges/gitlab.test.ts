import {
  assertGitLabHeaders,
  GITLAB_COM,
  GITLAB_CORP,
  graphQLCallsTo,
  graphQLRoute,
  jsonBody,
  JSON_CONTENT_TYPE,
  mockApprovals,
  mockGraphQL,
  mockMrList,
  mockApprove,
  mockCommitDiff,
  mockCompare,
  mockDiscussionAddNote,
  mockDiscussionCreate,
  mockDiscussionResolve,
  mockDraftNoteCreate,
  mockDraftNoteRemove,
  mockDraftNotes,
  mockDraftNotesBulkPublish,
  mockFileRaw,
  mockGetUser,
  mockMarkdownUpload,
  mockMrDiscussions,
  mockMrDiffs,
  mockMrNoteCreate,
  mockMrNoteRemove,
  mockMrRawDiffs,
  mockMrShow,
  mockProjectShow,
  mockUpload,
  mockUserById,
} from '@test/msw/gitlab';
import {
  callDiff,
  expectGitHubError,
  fixture,
  requests,
  requestsTo,
  resetMocks,
  server,
} from '@test/msw/shared';
import { http, HttpResponse } from 'msw';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

import { gitLabForge, gitLabProjectVisible } from './gitlab';
import type { PullRef, RepoRef } from '@/lib/forges';
import type { GitLabTarget } from '@/lib/reviewTarget';

// The forge against msw: real HTTP through gitbeaker and the hand-rolled
// fetchers, answered with the responses `test/fixtures/record/gitlab.mjs`
// recorded from gitlab.com itself (see `test/fixtures/gitlab/_meta.json`).
// gitlab-org/gitlab-vscode-extension!3334 is a merged seven-file MR whose
// head sha answers the commit diff, and 925c5a41...ee095772 the compare. The
// recorded compare's package-lock.json arrives `collapsed` with an empty
// diff, so the synthesis notice is exercised on a real answer. The answers
// nothing anonymous can produce — a pure rename, a `too_large` flag, a
// /user that names somebody, and an MR's discussions, which answer 401
// without one — are hand-shaped and marked where they appear; the /user 401
// is the recorded one.

/** A file diff as GitLab's JSON reports it, in the fields the tests read. */
interface GitLabFileDiffJson {
  old_path: string;
  new_path: string;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
  diff?: string;
  too_large?: boolean;
  collapsed?: boolean;
}

/** A merge request in the fields the rail reads. */
interface GitLabMergeRequestJson {
  iid: number;
  title?: string;
  draft?: boolean;
  author?: { username?: string; avatar_url?: string };
  web_url?: string;
  updated_at?: string;
  source_branch?: string;
  target_branch?: string;
  head_pipeline?: { status?: string } | null;
}

/** A discussion as the recorded fixtures carry it, in the fields asserted. */
interface GitLabDiscussionJson {
  id: string;
  individual_note?: boolean;
  notes?: {
    id: number;
    type?: string | null;
    system?: boolean;
    body?: string;
    author?: { id?: number; username?: string };
    resolvable?: boolean;
    resolved?: boolean;
    position?: {
      new_path?: string;
      old_path?: string;
      new_line?: number;
      old_line?: number;
      line_range?: {
        start?: { new_line?: number; old_line?: number; line_code?: string };
        end?: { new_line?: number; old_line?: number; line_code?: string };
      };
    };
  }[];
}

const MR_SHOW = fixture<{
  sha: string;
  diff_refs: { base_sha: string; start_sha: string; head_sha: string };
}>('gitlab', 'mr-show.json');
const MR_DIFFS = fixture<GitLabFileDiffJson[]>('gitlab', 'mr-diffs.json');
const COMMIT_DIFF = fixture<GitLabFileDiffJson[]>('gitlab', 'commit-diff.json');
const COMPARE = fixture<{ diffs: GitLabFileDiffJson[] }>(
  'gitlab',
  'compare.json'
);
const PROJECT_404 = fixture<{ message: string }>('gitlab', 'project-404.json');
const USER_401 = fixture<{ message: string }>('gitlab', 'user-401.json');
const APPROVAL_STATE = fixture<{
  rules: { approved_by?: { username?: string }[] }[];
}>('gitlab', 'approval-state.json');

// The recorded approval state is EE-only, so the all-tiers configuration
// answer is derived from it: the same recorded approver, in the
// `approved_by[].user` shape that endpoint reports.
const APPROVALS = {
  approved_by: APPROVAL_STATE.rules.flatMap((rule) =>
    (rule.approved_by ?? []).map((user) => ({ user }))
  ),
};
const MR_LIST = fixture<GitLabMergeRequestJson[]>('gitlab', 'mr-list.json');
const RAW_DIFFS = readFileSync(
  new URL(
    '../../../../test/fixtures/gitlab/mr-raw-diffs.diff',
    import.meta.url
  ),
  'utf8'
);
const FILE_TEXT = readFileSync(
  new URL('../../../../test/fixtures/gitlab/file.txt', import.meta.url),
  'utf8'
);

const TOKEN = 'glpat-test-token';

const PROJECT = 'gitlab-org/gitlab-vscode-extension';
const HEAD_SHA = 'ee095772260696052b74058d58bb7adf2b1aead9';

const MR_TARGET: GitLabTarget = {
  kind: 'gitlab-mr',
  host: GITLAB_COM,
  project: PROJECT,
  number: 3334,
};
const COMMIT_TARGET: GitLabTarget = {
  kind: 'gitlab-commit',
  host: GITLAB_COM,
  project: PROJECT,
  sha: HEAD_SHA,
};
const COMPARE_TARGET: GitLabTarget = {
  kind: 'gitlab-compare',
  host: GITLAB_COM,
  project: PROJECT,
  base: '925c5a41',
  head: HEAD_SHA,
};

const MR_PULL: PullRef = {
  forge: 'gitlab',
  host: GITLAB_COM,
  project: PROJECT,
  number: 3334,
};
const REPO_9_PULL: PullRef = {
  forge: 'gitlab',
  host: GITLAB_COM,
  project: 'group/repo',
  number: 9,
};

/** The line-code prefix GitLab hashes from the path, by its own formula. */
function fileHash(path: string): string {
  return createHash('sha1').update(path).digest('hex');
}

beforeAll(() => {
  server.listen();
});

afterEach(() => {
  resetMocks();
});

afterAll(() => {
  server.close();
});

describe('viewer', () => {
  it('answers with nobody and asks nothing without a token', async () => {
    const viewer = await gitLabForge.viewer({}, GITLAB_COM);
    assert.equal(viewer, undefined);
    assert.equal(requests.length, 0);
  });

  it('maps the token’s user', async () => {
    // Hand-shaped: /user answers only for a credential, so nothing anonymous
    // can be recorded. The field names are GitLab's own.
    mockGetUser(GITLAB_COM, {
      body: {
        username: 'octocat',
        avatar_url:
          'https://gitlab.com/uploads/-/system/user/avatar/1/avatar.png',
        name: 'Octo Cat',
      },
    });
    const viewer = await gitLabForge.viewer({ token: TOKEN }, GITLAB_COM);

    assert.deepEqual(viewer, {
      login: 'octocat',
      avatarUrl: 'https://gitlab.com/uploads/-/system/user/avatar/1/avatar.png',
      name: 'Octo Cat',
    });
    const [call] = requests;
    assert.equal(call.path, '/api/v4/user');
    assertGitLabHeaders(call, { token: TOKEN });
  });

  it('sends a private token as private-token', async () => {
    mockGetUser(GITLAB_COM, {
      body: { username: 'octocat', avatar_url: null, name: null },
    });
    const viewer = await gitLabForge.viewer(
      { token: TOKEN, scheme: 'private-token' },
      GITLAB_COM
    );

    assert.equal(viewer?.login, 'octocat');
    const [call] = requests;
    assertGitLabHeaders(call, { token: TOKEN, scheme: 'private-token' });
  });

  it('needs a host before it asks anything', async () => {
    await expectGitHubError(gitLabForge.viewer({ token: TOKEN }), {
      status: 400,
      message: { fragment: 'needs a host' },
    });
    assert.equal(requests.length, 0);
  });

  it('asks the host it is given', async () => {
    mockGetUser(GITLAB_CORP, { body: { username: 'octocat' } });
    const viewer = await gitLabForge.viewer({ token: TOKEN }, GITLAB_CORP);

    assert.equal(viewer?.login, 'octocat');
    const [call] = requests;
    assert.equal(call.host, GITLAB_CORP);
    assertGitLabHeaders(call, { token: TOKEN });
    assert.equal(requestsTo(GITLAB_COM).length, 0);
  });

  it('turns a 401 into a GitHubError with GitLab’s sentence', async () => {
    mockGetUser(GITLAB_COM, { body: USER_401, status: 401 });
    await expectGitHubError(
      gitLabForge.viewer({ token: 'bad-token' }, GITLAB_COM),
      { status: 401, message: '401 Unauthorized' }
    );
  });
});

describe('diff: merge request', () => {
  it('streams the raw diff when the endpoint answers', async () => {
    mockMrShow(GITLAB_COM, { body: MR_SHOW });
    mockMrRawDiffs(GITLAB_COM, { body: RAW_DIFFS });
    const response = await callDiff(gitLabForge, MR_TARGET, {});

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-ghdiff-notice'), null);
    assert.equal(await response.text(), RAW_DIFFS);

    // The diff_refs read, then the raw diff; the JSON fallback was never asked.
    assert.equal(requests.length, 2);
    const [call] = requestsTo(
      GITLAB_COM,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/raw_diffs'
    );
    assertGitLabHeaders(call);
  });

  it('tags the diff by its commits, and answers 304 to a browser that has it', async () => {
    mockMrShow(GITLAB_COM, { body: MR_SHOW });
    mockMrRawDiffs(GITLAB_COM, { body: RAW_DIFFS });
    const first = await callDiff(gitLabForge, MR_TARGET, {});
    const etag = first.headers.get('etag');
    assert.ok(etag != null && etag.includes(MR_SHOW.sha));

    requests.length = 0;
    const again = await gitLabForge.diff(
      MR_TARGET,
      {},
      { set() {} } as never,
      etag
    );
    assert.equal(again.status, 304);
    assert.equal(again.headers.get('etag'), etag);
    // Only the diff_refs read: the patch itself is not asked for again.
    assert.equal(
      requestsTo(
        GITLAB_COM,
        '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/raw_diffs'
      ).length,
      0
    );
  });

  it('never confirms a commit tag of one project for another', async () => {
    mockCommitDiff(GITLAB_COM, { 1: { body: COMMIT_DIFF } });
    const first = await callDiff(gitLabForge, COMMIT_TARGET, {});
    const etag = first.headers.get('etag');
    assert.ok(etag != null);

    // Same sha, the same answer: confirmed without asking the instance.
    requests.length = 0;
    const same = await gitLabForge.diff(
      COMMIT_TARGET,
      {},
      { set() {} } as never,
      etag
    );
    assert.equal(same.status, 304);
    assert.equal(requests.length, 0);

    // Same sha under another project: read afresh, never a 304.
    const other = await gitLabForge.diff(
      { ...COMMIT_TARGET, project: 'someone/else' },
      {},
      { set() {} } as never,
      etag
    );
    assert.notEqual(other.status, 304);
  });

  it('serves the diff untagged when the diff_refs read fails', async () => {
    mockMrRawDiffs(GITLAB_COM, { body: RAW_DIFFS });
    const response = await callDiff(gitLabForge, MR_TARGET, {});

    assert.equal(await response.text(), RAW_DIFFS);
    assert.equal(response.headers.get('etag'), null);
  });

  it('synthesizes a patch from the JSON diffs when the raw endpoint 404s', async () => {
    mockMrRawDiffs(GITLAB_COM, {
      status: 404,
      body: jsonBody(PROJECT_404),
      headers: JSON_CONTENT_TYPE,
    });
    mockMrDiffs(GITLAB_COM, { 1: { body: MR_DIFFS } });
    mockMrShow(GITLAB_COM, { body: MR_SHOW });
    const response = await callDiff(gitLabForge, MR_TARGET, { token: TOKEN });

    const patch = await response.text();
    assert.ok(
      patch.startsWith(
        'diff --git a/scripts/transpile_es_to_cjs_for_integration_tests.mjs b/scripts/transpile_es_to_cjs_for_integration_tests.mjs'
      )
    );
    assert.ok(
      patch.includes(
        'diff --git a/jest_esm_transformer.js b/jest_esm_transformer.js\nnew file mode 100644\n--- /dev/null\n+++ b/jest_esm_transformer.js'
      )
    );
    assert.ok(
      patch.includes(
        'diff --git a/babel.config.js b/babel.config.js\ndeleted file mode 100644\n--- a/babel.config.js\n+++ /dev/null'
      )
    );
    // Every recorded file carried its hunks, so the notice stays off.
    assert.equal(response.headers.get('x-ghdiff-notice'), null);

    assert.equal(requests.length, 3);
    assertGitLabHeaders(requests[0], { token: TOKEN });
    const [json] = requestsTo(
      GITLAB_COM,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/diffs'
    );
    assert.equal(json.query.per_page, '100');
    assertGitLabHeaders(json, { token: TOKEN });
  });

  it('reports GitLab’s sentence when both attempts 404', async () => {
    mockMrRawDiffs(GITLAB_COM, {
      status: 404,
      body: jsonBody(PROJECT_404),
      headers: JSON_CONTENT_TYPE,
    });
    mockMrDiffs(GITLAB_COM, { 1: { body: PROJECT_404, status: 404 } });

    await expectGitHubError(callDiff(gitLabForge, MR_TARGET, {}), {
      status: 404,
      message: '404 Project Not Found',
    });
  });

  it('prefers the raw attempt’s 404 when the JSON list fails otherwise', async () => {
    mockMrRawDiffs(GITLAB_COM, {
      status: 404,
      body: jsonBody(PROJECT_404),
      headers: JSON_CONTENT_TYPE,
    });
    // A current instance has the raw endpoint, so its 404 is the honest
    // answer; the JSON failure's 500 would send the reviewer elsewhere.
    mockMrDiffs(GITLAB_COM, {
      1: { body: { message: 'Something went wrong' }, status: 500 },
    });

    await expectGitHubError(callDiff(gitLabForge, MR_TARGET, {}), {
      status: 404,
      message: '404 Project Not Found',
    });
  });

  it('reports the JSON list’s 404 when the raw attempt failed otherwise', async () => {
    // A 502 on the raw stream says nothing about the merge request; the JSON
    // list is the attempt whose 404 can.
    mockMrRawDiffs(GITLAB_COM, { status: 502, body: 'Bad gateway' });
    mockMrDiffs(GITLAB_COM, { 1: { body: PROJECT_404, status: 404 } });

    await expectGitHubError(callDiff(gitLabForge, MR_TARGET, {}), {
      status: 404,
      message: '404 Project Not Found',
    });
  });

  it('follows the JSON list’s pages when the raw endpoint 404s', async () => {
    mockMrRawDiffs(GITLAB_COM, {
      status: 404,
      body: jsonBody(PROJECT_404),
      headers: JSON_CONTENT_TYPE,
    });
    // Hand-shaped pagination over the recorded files: the first page carries
    // the `link` header GitLab answers a next page with, the second ends it.
    const [first, second, ...rest] = MR_DIFFS;
    mockMrDiffs(GITLAB_COM, {
      1: {
        body: [first, second],
        headers: {
          link: `<https://${GITLAB_COM}/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/diffs?page=2&per_page=100>; rel="next"`,
        },
      },
      2: { body: rest },
    });
    const response = await callDiff(gitLabForge, MR_TARGET, {});

    // Every page's files made the one patch, in the list's own order.
    const patch = await response.text();
    assert.ok(
      patch.startsWith(`diff --git a/${first.new_path} b/${first.new_path}`)
    );
    for (const diff of MR_DIFFS) {
      assert.ok(
        patch.includes(`diff --git a/${diff.old_path} b/${diff.new_path}`)
      );
    }

    const pages = requestsTo(
      GITLAB_COM,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/diffs'
    );
    assert.equal(pages.length, 2);
    assert.equal(pages[0].query.page, undefined);
    assert.equal(pages[1].query.page, '2');
    assert.equal(pages[1].query.per_page, '100');
    assertGitLabHeaders(pages[1]);
  });
});

describe('diff: commit', () => {
  it('synthesizes a patch from the recorded commit diff', async () => {
    mockCommitDiff(GITLAB_COM, { 1: { body: COMMIT_DIFF } });
    const response = await callDiff(gitLabForge, COMMIT_TARGET, {});

    const patch = await response.text();
    assert.ok(patch.startsWith('diff --git a/.eslintrc.json b/.eslintrc.json'));
    assert.ok(
      patch.includes(
        'diff --git a/jest_esm_transformer.js b/jest_esm_transformer.js\nnew file mode 100644'
      )
    );
    assert.ok(
      patch.includes(
        'diff --git a/babel.config.js b/babel.config.js\ndeleted file mode 100644'
      )
    );
    assert.equal(response.headers.get('x-ghdiff-notice'), null);

    assert.equal(requests.length, 1);
    const [call] = requests;
    assert.equal(
      call.path,
      `/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/repository/commits/${HEAD_SHA}/diff`
    );
    assert.equal(call.query.per_page, '100');
    assertGitLabHeaders(call);
  });

  it('names the file GitLab judged too large, and drops its hunks', async () => {
    // Hand-shaped: the recorded commit diff with its first file flagged.
    // `too_large` with an empty diff is how the instance reports a file it
    // would not render.
    const diffs: GitLabFileDiffJson[] = COMMIT_DIFF.map((diff, index) =>
      index === 0 ? { ...diff, diff: '', too_large: true } : diff
    );
    mockCommitDiff(GITLAB_COM, { 1: { body: diffs } });
    const response = await callDiff(gitLabForge, COMMIT_TARGET, {});

    const patch = await response.text();
    const notice = response.headers.get('x-ghdiff-notice') ?? '';
    assert.match(notice, /too large to diff/);
    assert.ok(notice.includes('.eslintrc.json'), notice);
    // The file keeps its place in the patch, but its recorded hunk — the only
    // one carrying "jest_*.js" — is gone.
    assert.ok(patch.includes('diff --git a/.eslintrc.json b/.eslintrc.json'));
    assert.ok(!patch.includes('"jest_*.js"'));
  });

  it('turns a spent quota into a 429 with GitLab’s sentence', async () => {
    // The forge's requester keeps no retry loop of its own, so the status
    // reaches the reviewer as it arrived — and exactly once.
    mockCommitDiff(GITLAB_COM, {
      1: { body: { message: 'Retry later' }, status: 429 },
    });

    await expectGitHubError(callDiff(gitLabForge, COMMIT_TARGET, {}), {
      status: 429,
      message: 'Retry later',
    });
    assert.equal(requests.length, 1);
  });
});

describe('diff: compare', () => {
  it('synthesizes a patch from the recorded compare', async () => {
    mockCompare(GITLAB_COM, { body: COMPARE });
    const response = await callDiff(gitLabForge, COMPARE_TARGET, {});

    const patch = await response.text();
    assert.ok(patch.startsWith('diff --git a/.eslintrc.json b/.eslintrc.json'));
    // The recorded compare collapses package-lock.json, so the notice names
    // it and the patch keeps its header without hunks.
    const notice = response.headers.get('x-ghdiff-notice') ?? '';
    assert.match(notice, /too large to diff/);
    assert.ok(notice.includes('package-lock.json'), notice);
    assert.ok(
      patch.includes('diff --git a/package-lock.json b/package-lock.json')
    );

    assert.equal(requests.length, 1);
    const [call] = requests;
    assert.equal(
      call.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/repository/compare'
    );
    assert.equal(call.query.from, '925c5a41');
    assert.equal(call.query.to, HEAD_SHA);
    assertGitLabHeaders(call);
  });

  it('renders a pure rename without hunks or a notice', async () => {
    // Hand-shaped: the recorded answers carry no rename. A rename whose diff
    // is empty is a rename with the content untouched.
    mockCompare(GITLAB_COM, {
      body: {
        diffs: [
          {
            old_path: 'src/feature/old-name.ts',
            new_path: 'src/feature/new-name.ts',
            new_file: false,
            deleted_file: false,
            renamed_file: true,
            diff: '',
            too_large: false,
          },
        ],
      },
    });
    const response = await callDiff(gitLabForge, COMPARE_TARGET, {});

    assert.equal(
      await response.text(),
      'diff --git a/src/feature/old-name.ts b/src/feature/new-name.ts\n' +
        'similarity index 100%\n' +
        'rename from src/feature/old-name.ts\n' +
        'rename to src/feature/new-name.ts\n'
    );
    assert.equal(response.headers.get('x-ghdiff-notice'), null);
  });

  it('says so when GitLab timed the comparison out', async () => {
    // Hand-shaped on the recorded compare: `compare_timeout` is how the
    // instance answers a comparison it could not finish — the files it had
    // already diffed, and the flag. The recorded answer's collapsed file
    // keeps its own half of the notice.
    mockCompare(GITLAB_COM, { body: { ...COMPARE, compare_timeout: true } });
    const response = await callDiff(gitLabForge, COMPARE_TARGET, {});

    const notice = response.headers.get('x-ghdiff-notice') ?? '';
    assert.match(notice, /timed out/);
    assert.ok(notice.includes('package-lock.json'), notice);
  });
});

describe('file', () => {
  it('reads a merge request’s file at its head, in two calls', async () => {
    mockMrShow(GITLAB_COM, { body: MR_SHOW });
    mockFileRaw(GITLAB_COM, { body: FILE_TEXT });
    const response = await gitLabForge.file(MR_TARGET, '.eslintrc.json', {});

    assert.equal(await response.text(), FILE_TEXT);
    assert.equal(requests.length, 2);
    const [show, raw] = requests;
    assert.equal(
      show.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334'
    );
    assertGitLabHeaders(show);
    assert.equal(
      raw.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/repository/files/.eslintrc.json/raw'
    );
    assert.equal(raw.query.ref, MR_SHOW.sha);
    assertGitLabHeaders(raw);
  });

  it('reads a commit’s file at the commit itself', async () => {
    mockFileRaw(GITLAB_COM, { body: FILE_TEXT });
    const response = await gitLabForge.file(COMMIT_TARGET, '.eslintrc.json', {
      token: TOKEN,
    });

    assert.equal(await response.text(), FILE_TEXT);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].query.ref, HEAD_SHA);
    assertGitLabHeaders(requests[0], { token: TOKEN });
  });

  it('reads a compare range’s file at its head', async () => {
    mockFileRaw(GITLAB_COM, { body: FILE_TEXT });
    await gitLabForge.file(COMPARE_TARGET, '.eslintrc.json', {});

    assert.equal(requests.length, 1);
    assert.equal(requests[0].query.ref, HEAD_SHA);
    assertGitLabHeaders(requests[0]);
  });

  it('turns a missing file into a 404 with GitLab’s sentence', async () => {
    mockFileRaw(GITLAB_COM, {
      status: 404,
      body: jsonBody(PROJECT_404),
      headers: JSON_CONTENT_TYPE,
    });

    await expectGitHubError(gitLabForge.file(COMMIT_TARGET, 'gone.ts', {}), {
      status: 404,
      message: '404 Project Not Found',
    });
  });

  it('says so when the merge request names no head', async () => {
    // Hand-shaped: a show answer without a sha, the one field the ref is
    // read from. The file itself is never asked for.
    mockMrShow(GITLAB_COM, { body: {} });

    await expectGitHubError(gitLabForge.file(MR_TARGET, '.eslintrc.json', {}), {
      status: 502,
      message: { fragment: 'did not name this merge request’s head' },
    });
    assert.equal(requests.length, 1);
  });
});

describe('media', () => {
  const PNG = {
    body: 'png-bytes',
    headers: { 'content-type': 'image/png' },
  };
  const API_UPLOAD = `/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/uploads/abc123/image.png`;

  it('downloads a body-form upload through the API, with the credential', async () => {
    // The web path an upload renders to answers only to a browser session;
    // the markdown uploads API is the one that takes the reviewer's grant.
    mockMarkdownUpload(GITLAB_COM, PNG);
    const response = await gitLabForge.media?.(
      MR_TARGET,
      '/uploads/abc123/image.png',
      { token: TOKEN }
    );

    assert.ok(response != null);
    assert.equal(await response.text(), 'png-bytes');
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, API_UPLOAD);
    assertGitLabHeaders(requests[0], { token: TOKEN });
  });

  it('reads an absolute upload address on the instance’s own host as the same upload', async () => {
    mockMarkdownUpload(GITLAB_COM, PNG);
    const response = await gitLabForge.media?.(
      MR_TARGET,
      `https://${GITLAB_COM}/uploads/abc123/image.png`,
      {}
    );

    assert.ok(response != null);
    assert.equal(await response.text(), 'png-bytes');
    assert.equal(requests[0].path, API_UPLOAD);
    assertGitLabHeaders(requests[0]);
  });

  it('reads the v1 web path of an upload as the same upload', async () => {
    mockMarkdownUpload(GITLAB_COM, PNG);
    const response = await gitLabForge.media?.(
      MR_TARGET,
      `https://${GITLAB_COM}/${PROJECT}/uploads/abc123/image.png`,
      {}
    );

    assert.ok(response != null);
    assert.equal(requests[0].path, API_UPLOAD);
  });

  it('reads the v2 id-based path of an upload by that id', async () => {
    mockMarkdownUpload(GITLAB_COM, PNG);
    const response = await gitLabForge.media?.(
      MR_TARGET,
      '/-/project/1234/uploads/abc123/image.png',
      {}
    );

    assert.ok(response != null);
    assert.equal(
      requests[0].path,
      '/api/v4/projects/1234/uploads/abc123/image.png'
    );
  });

  it('decodes an encoded filename once, so the API path encodes it once', async () => {
    // The address carries the name percent-encoded; encoding it again would
    // fetch `my%2520image.png`, a file that is not there.
    mockMarkdownUpload(GITLAB_COM, PNG);
    const response = await gitLabForge.media?.(
      MR_TARGET,
      '/uploads/abc123/my%20image.png',
      { token: TOKEN }
    );

    assert.ok(response != null);
    assert.equal(
      requests[0].path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/uploads/abc123/my%20image.png'
    );
  });

  it('reads the v1 web path of an encoded filename as the same upload', async () => {
    mockMarkdownUpload(GITLAB_COM, PNG);
    const response = await gitLabForge.media?.(
      MR_TARGET,
      `https://${GITLAB_COM}/${PROJECT}/uploads/abc123/my%20image.png`,
      {}
    );

    assert.ok(response != null);
    assert.equal(
      requests[0].path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/uploads/abc123/my%20image.png'
    );
  });

  it('keeps an encoded slash inside the filename one segment', async () => {
    mockMarkdownUpload(GITLAB_COM, PNG);
    const response = await gitLabForge.media?.(
      MR_TARGET,
      '/uploads/abc123/my%2Fimage.png',
      {}
    );

    assert.ok(response != null);
    assert.equal(
      requests[0].path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/uploads/abc123/my%2Fimage.png'
    );
  });

  it('refuses a malformed escape in a filename without fetching it', async () => {
    await expectGitHubError(
      gitLabForge.media?.(MR_TARGET, '/uploads/abc123/my%2image.png', {}) ??
        Promise.reject(new Error('no media')),
      { status: 400, message: { fragment: 'not valid' } }
    );
    assert.equal(requests.length, 0);
  });

  it('fetches a non-upload address on the instance as given', async () => {
    mockUpload(GITLAB_COM, `/${PROJECT}/-/raw/main/doc/figure.png`, PNG);
    const response = await gitLabForge.media?.(
      MR_TARGET,
      `https://${GITLAB_COM}/${PROJECT}/-/raw/main/doc/figure.png`,
      { token: TOKEN }
    );

    assert.ok(response != null);
    assert.equal(requests[0].path, `/${PROJECT}/-/raw/main/doc/figure.png`);
    assertGitLabHeaders(requests[0], { token: TOKEN });
  });

  it('refuses an address on any other host without fetching it', async () => {
    await expectGitHubError(
      gitLabForge.media?.(MR_TARGET, 'https://elsewhere.com/image.png', {
        token: TOKEN,
      }) ?? Promise.reject(new Error('no media')),
      { status: 400, message: { fragment: 'not on this instance' } }
    );
    assert.equal(requests.length, 0);
  });

  it('refuses a plaintext address on the instance without fetching it', async () => {
    // The first hop carries the reviewer's credential, so an http: address
    // on the instance's own host is refused before any fetch is made.
    await expectGitHubError(
      gitLabForge.media?.(
        MR_TARGET,
        `http://${GITLAB_COM}/uploads/abc123/image.png`,
        { token: TOKEN }
      ) ?? Promise.reject(new Error('no media')),
      { status: 400, message: { fragment: 'not on this instance' } }
    );
    assert.equal(requests.length, 0);
  });

  it('refuses a relative address that is no upload', async () => {
    await expectGitHubError(
      gitLabForge.media?.(MR_TARGET, '/somewhere/image.png', {}) ??
        Promise.reject(new Error('no media')),
      { status: 400, message: { fragment: 'not valid' } }
    );
    assert.equal(requests.length, 0);
  });

  it('maps an untyped answer from the upload’s extension', async () => {
    // A pasted screenshot whose type was never recorded arrives as
    // application/octet-stream; the .png in its name is the answer.
    mockMarkdownUpload(GITLAB_COM, {
      body: 'jpeg-bytes',
      headers: { 'content-type': 'application/octet-stream' },
    });
    const response = await gitLabForge.media?.(
      MR_TARGET,
      '/uploads/abc123/image.png',
      {}
    );

    assert.ok(response != null);
    assert.equal(await response.text(), 'jpeg-bytes');
    assert.equal(response.headers.get('content-type'), 'image/png');
  });

  it('refuses an untyped answer whose extension is no image either', async () => {
    mockMarkdownUpload(GITLAB_COM, {
      body: 'zip-bytes',
      headers: { 'content-type': 'application/octet-stream' },
    });

    await expectGitHubError(
      gitLabForge.media?.(MR_TARGET, '/uploads/abc123/archive.zip', {}) ??
        Promise.reject(new Error('no media')),
      {
        status: 415,
        message: { fragment: 'not an image (got application/octet-stream)' },
      }
    );
  });

  it('refuses an answer that is not an image, naming what it was', async () => {
    // The sign-in page an expired token earns is text/html, and so is a 404
    // the web host draws — neither is a picture.
    mockMarkdownUpload(GITLAB_COM, {
      body: '<html>sign in</html>',
      headers: { 'content-type': 'text/html' },
    });

    await expectGitHubError(
      gitLabForge.media?.(MR_TARGET, '/uploads/abc123/image.png', {}) ??
        Promise.reject(new Error('no media')),
      { status: 415, message: { fragment: 'not an image (got text/html)' } }
    );
  });

  it('follows a redirect that stays on the instance, credential and all', async () => {
    mockMarkdownUpload(GITLAB_COM, {
      status: 302,
      body: '',
      headers: { location: '/api/v4/elsewhere/final.png' },
    });
    mockUpload(GITLAB_COM, '/api/v4/elsewhere/final.png', PNG);
    const response = await gitLabForge.media?.(
      MR_TARGET,
      '/uploads/abc123/image.png',
      { token: TOKEN }
    );

    assert.ok(response != null);
    assert.equal(await response.text(), 'png-bytes');
    assert.equal(requests.length, 2);
    assertGitLabHeaders(requests[1], { token: TOKEN });
  });

  it('follows a presigned redirect off the instance, leaving the credential behind', async () => {
    // Object storage's presign is the ordinary shape of a download there:
    // the instance vouches for the target, and the grant is not its business.
    mockMarkdownUpload(GITLAB_COM, {
      status: 302,
      body: '',
      headers: { location: 'https://objects.elsewhere.com/signed' },
    });
    mockUpload('objects.elsewhere.com', '/signed', PNG);
    const response = await gitLabForge.media?.(
      MR_TARGET,
      '/uploads/abc123/image.png',
      { token: TOKEN }
    );

    assert.ok(response != null);
    assert.equal(await response.text(), 'png-bytes');
    assert.equal(requests.length, 2);
    assertGitLabHeaders(requests[1]);
  });
});

describe('pullDetails', () => {
  it('reads a locked merge request as open, not closed', async () => {
    // Hand-shaped on the recorded show answer: `locked` is the instance's
    // state for an open merge request whose discussions are held, and the
    // details card must not read Closed for it.
    mockMrShow(GITLAB_COM, {
      body: {
        iid: 3334,
        title: 'A held merge request',
        state: 'locked',
        draft: false,
        author: { username: 'ohoral' },
        web_url:
          'https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/merge_requests/3334',
        source_branch: 'feature',
        target_branch: 'main',
        created_at: '2026-08-27T10:00:00.000Z',
        updated_at: '2026-09-01T10:00:00.000Z',
        description: null,
        changes_count: '3',
      },
    });
    const details = await gitLabForge.pullDetails(MR_PULL, { token: TOKEN });

    assert.equal(details.state, 'open');
    assert.equal(details.title, 'A held merge request');
    assert.equal(details.changedFiles, 3);
  });

  it('maps the head pipeline to the check axis when a token rides', async () => {
    mockMrShow(GITLAB_COM, {
      body: {
        iid: 3334,
        title: 'A green merge request',
        state: 'opened',
        draft: false,
        head_pipeline: { status: 'success' },
      },
    });
    const details = await gitLabForge.pullDetails(MR_PULL, { token: TOKEN });

    assert.equal(details.check, 'success');
  });

  it('reports no checks as none, and a tokenless read as never asked', async () => {
    mockMrShow(GITLAB_COM, {
      body: { iid: 3334, title: 'No pipeline', state: 'opened' },
    });
    const withToken = await gitLabForge.pullDetails(MR_PULL, { token: TOKEN });
    assert.equal(withToken.check, 'none');

    mockMrShow(GITLAB_COM, {
      body: {
        iid: 3334,
        title: 'No pipeline',
        state: 'opened',
        head_pipeline: { status: 'success' },
      },
    });
    const anonymous = await gitLabForge.pullDetails(MR_PULL, {});
    assert.equal(anonymous.check, undefined);
  });
});

// Hand-shaped: gitlab.com answers an MR's discussions with 401 for an
// anonymous caller, so no real page can be recorded. The reply lookup in
// comments.create only needs a thread that holds a known note id; the field
// shapes follow a real discussions answer.
const DISCUSSIONS = [
  {
    id: '8f4e2d1c0a1b2c3d4e5f6a7b8c9d0e1f',
    notes: [
      {
        id: 501,
        type: 'DiffNote',
        system: false,
        body: 'This reads as if the flag defaults on.',
        author: {
          username: 'ohoral',
          avatar_url:
            'https://secure.gravatar.com/avatar/2ea5c5fc?s=80&d=identicon',
          bot: false,
        },
        created_at: '2026-08-27T10:12:00.000Z',
        position: {
          new_path: 'src/extension.ts',
          old_path: 'src/extension.ts',
          new_line: 42,
        },
      },
    ],
  },
  {
    id: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
    notes: [
      {
        id: 601,
        type: 'DiffNote',
        system: false,
        body: 'Why does this helper go away?',
        author: {
          username: 'dependency-review-bot',
          avatar_url:
            'https://gitlab.com/uploads/-/system/user/avatar/2/avatar.png',
          bot: true,
        },
        created_at: '2026-08-27T11:00:00.000Z',
        position: {
          new_path: 'src/transpile.ts',
          old_path: 'src/transpile.ts',
          old_line: 17,
        },
      },
      {
        id: 602,
        type: 'DiffNote',
        system: false,
        body: 'The esbuild plugin covers it.',
        author: {
          username: 'ohoral',
          avatar_url:
            'https://secure.gravatar.com/avatar/2ea5c5fc?s=80&d=identicon',
          bot: false,
        },
        created_at: '2026-08-27T11:05:00.000Z',
        position: {
          new_path: 'src/transpile.ts',
          old_path: 'src/transpile.ts',
          old_line: 17,
        },
      },
      {
        id: 603,
        type: null,
        system: true,
        body: 'changed this line in version 2 of the diff',
        author: { username: 'ohoral' },
        created_at: '2026-08-27T11:06:00.000Z',
      },
    ],
  },
  {
    id: '9c8b7a6f5e4d3c2b1a09f8e7d6c5b4a3',
    notes: [
      {
        id: 701,
        type: 'DiscussionNote',
        system: false,
        body: 'A remark about the merge request as a whole.',
        author: { username: 'ohoral' },
        created_at: '2026-08-27T12:00:00.000Z',
      },
    ],
  },
];

describe('comments.list', () => {
  // Recorded from a private instance and anonymized — see
  // `test/fixtures/gitlab/_meta.json`. Five discussions that cover the whole
  // matrix: a whole-MR note, a resolved diff thread with a reply, a resolved
  // whole-MR thread, a `line_range` on a context line, and one on a hunk's
  // bottom row. Every note author carries the restricted serialization, with
  // no `bot` field — which is what the per-author reads below answer.
  const THREADS = fixture<GitLabDiscussionJson[]>(
    'gitlab',
    'mr-discussions-threads.json'
  );
  const BOT_NOTES = fixture<GitLabDiscussionJson[]>(
    'gitlab',
    'mr-discussions-bot.json'
  );
  const USER_REVIEW_BOT = fixture<unknown>('gitlab', 'user-review-bot.json');
  const USER_PROJECT_BOT = fixture<unknown>('gitlab', 'user-project-bot.json');
  const USER_HUMAN = fixture<unknown>('gitlab', 'user-human.json');
  const USER_HUMAN_TWO = fixture<unknown>('gitlab', 'user-human-two.json');
  const USER_HUMAN_THREE = fixture<unknown>('gitlab', 'user-human-three.json');

  it('maps recorded discussions to diff and merge-request payloads', async () => {
    mockMrDiscussions(GITLAB_COM, { 1: { body: THREADS } });
    mockUserById(GITLAB_COM, {
      12: { body: USER_REVIEW_BOT },
      13: { body: USER_HUMAN },
      14: { body: USER_HUMAN_TWO },
      15: { body: USER_HUMAN_THREE },
    });
    const payloads = await gitLabForge.comments.list(MR_PULL, { token: TOKEN });

    // Ten notes survive; the system notes go.
    assert.equal(payloads.length, 10);

    // The whole-MR note lands in its own scope, with no line or side…
    const mrNote = payloads.find((p) => p.remoteId === 1562070);
    assert.equal(mrNote?.scope, 'merge-request');
    assert.equal(mrNote?.path, '');
    assert.equal(mrNote?.line, undefined);
    assert.equal(mrNote?.side, undefined);
    // …is not resolvable, so it carries no resolved flag and no thread id…
    assert.equal(mrNote?.resolved, undefined);
    assert.equal(mrNote?.threadId, undefined);
    // …and the custom-named bot is a bot because the per-author read says
    // so — the note's own author object never carries the flag.
    assert.equal(mrNote?.authorIsBot, true);

    // A resolved diff thread: the flag on the root, the reply threaded.
    const root = payloads.find((p) => p.remoteId === 1562098);
    assert.equal(root?.scope, undefined);
    assert.equal(root?.side, 'additions');
    assert.equal(root?.line, 22);
    assert.equal(root?.resolved, true);
    assert.equal(root?.authorIsBot, true);
    // The discussion id the resolve call addresses travels with the state.
    assert.equal(root?.threadId, '39f40d74541e43c3c9085cdf89573ff683a080df');
    const reply = payloads.find((p) => p.remoteId === 1562106);
    assert.equal(reply?.replyToId, 1562098);
    assert.equal(reply?.authorIsBot, false);
    assert.equal(reply?.resolved, undefined);
    assert.equal(reply?.threadId, undefined);

    // A resolved whole-MR thread is merge-request scoped and threaded too —
    // and it is resolvable, so it carries the id as well.
    const mrThread = payloads.find((p) => p.remoteId === 1562099);
    assert.equal(mrThread?.scope, 'merge-request');
    assert.equal(mrThread?.resolved, true);
    assert.equal(
      mrThread?.threadId,
      '83bfd518140f1b9ac8f25fb0a9c1230d3290b596'
    );
    assert.equal(
      payloads.find((p) => p.remoteId === 1567323)?.replyToId,
      1562099
    );

    // A line_range whose two ends are the same diff row is no range.
    const contextLine = payloads.find((p) => p.remoteId === 1572351);
    assert.equal(contextLine?.startLine, undefined);
    assert.equal(contextLine?.side, 'deletions');
    const bottomRow = payloads.find((p) => p.remoteId === 1572760);
    assert.equal(bottomRow?.startLine, undefined);
    assert.equal(bottomRow?.line, 188);
    assert.equal(bottomRow?.side, 'additions');

    // Every distinct author is read once for the bot flag.
    assert.deepEqual(
      requestsTo(GITLAB_COM, '/api/v4/users/')
        .map((call) => call.path)
        .sort(),
      [
        '/api/v4/users/12',
        '/api/v4/users/13',
        '/api/v4/users/14',
        '/api/v4/users/15',
      ]
    );

    // The discussions page itself, at the capped page size.
    const [discussionsCall] = requestsTo(
      GITLAB_COM,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/discussions'
    );
    assert.equal(discussionsCall.query.per_page, '100');
    assertGitLabHeaders(discussionsCall, { token: TOKEN });
  });

  it('maps a project bot’s whole-MR notes, with the username as the fallback', async () => {
    mockMrDiscussions(GITLAB_COM, { 1: { body: BOT_NOTES } });
    mockUserById(GITLAB_COM, { 11: { body: USER_PROJECT_BOT } });

    const enriched = await gitLabForge.comments.list(MR_PULL, {
      token: TOKEN,
    });
    // Six whole-MR notes survive; the system notes go.
    assert.equal(enriched.length, 6);
    assert.ok(enriched.every((p) => p.scope === 'merge-request'));
    assert.equal(enriched[0]?.authorIsBot, true);

    // Anonymous: no per-author read is possible, and the reserved
    // `project_…_bot_…` username still answers.
    resetMocks();
    mockMrDiscussions(GITLAB_COM, { 1: { body: BOT_NOTES } });
    const anonymous = await gitLabForge.comments.list(MR_PULL, {});
    assert.equal(anonymous.length, 6);
    assert.equal(anonymous[0]?.authorIsBot, true);
    assert.equal(requestsTo(GITLAB_COM, '/api/v4/users/').length, 0);
  });

  it('pairs each note’s side with the coordinate that exists', async () => {
    // Hand-shaped. A context line carries both numbers, and they differ once
    // the file has changes above: the side must come from the same
    // coordinate as the number, or the note anchors to a row it never sat
    // on. A range over context lines pairs the same way, start included.
    mockMrDiscussions(GITLAB_COM, {
      1: {
        body: [
          {
            id: 'shifted-context',
            notes: [
              {
                id: 801,
                type: 'DiffNote',
                system: false,
                body: 'On a context line.',
                author: { username: 'ohoral' },
                position: {
                  new_path: 'src/file-1.ts',
                  old_path: 'src/file-1.ts',
                  old_line: 10,
                  new_line: 15,
                },
              },
            ],
          },
          {
            id: 'addition-note',
            notes: [
              {
                id: 802,
                type: 'DiffNote',
                system: false,
                body: 'On an addition.',
                author: { username: 'ohoral' },
                position: {
                  new_path: 'src/file-1.ts',
                  old_path: 'src/file-1.ts',
                  old_line: null,
                  new_line: 22,
                },
              },
            ],
          },
          {
            id: 'deletion-note',
            notes: [
              {
                id: 803,
                type: 'DiffNote',
                system: false,
                body: 'On a deletion.',
                author: { username: 'ohoral' },
                position: {
                  new_path: 'src/file-2.ts',
                  old_path: 'src/file-2.ts',
                  old_line: 17,
                  new_line: null,
                },
              },
            ],
          },
          {
            id: 'context-range',
            notes: [
              {
                id: 804,
                type: 'DiffNote',
                system: false,
                body: 'Over context lines.',
                author: { username: 'ohoral' },
                position: {
                  new_path: 'src/file-3.ts',
                  old_path: 'src/old-name.ts',
                  old_line: 20,
                  new_line: 25,
                  line_range: {
                    start: {
                      line_code: `${fileHash('src/file-3.ts')}_18_23`,
                      type: 'expanded',
                      old_line: 18,
                      new_line: 23,
                    },
                    end: {
                      line_code: `${fileHash('src/file-3.ts')}_20_25`,
                      type: 'expanded',
                      old_line: 20,
                      new_line: 25,
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    });
    const payloads = await gitLabForge.comments.list(MR_PULL, {});

    // The shifted context line: the old side, the old number — not the new
    // file's 15 read as a deletion.
    const context = payloads.find((p) => p.remoteId === 801);
    assert.equal(context?.side, 'deletions');
    assert.equal(context?.line, 10);
    const addition = payloads.find((p) => p.remoteId === 802);
    assert.equal(addition?.side, 'additions');
    assert.equal(addition?.line, 22);
    const deletion = payloads.find((p) => p.remoteId === 803);
    assert.equal(deletion?.side, 'deletions');
    assert.equal(deletion?.line, 17);
    const range = payloads.find((p) => p.remoteId === 804);
    assert.equal(range?.side, 'deletions');
    assert.equal(range?.line, 20);
    assert.equal(range?.startSide, 'deletions');
    assert.equal(range?.startLine, 18);
    // A renamed file anchors to its new path.
    assert.equal(range?.path, 'src/file-3.ts');
  });
});

describe('comments.create', () => {
  it('finds the thread, then posts the reply onto it', async () => {
    mockMrDiscussions(GITLAB_COM, { 1: { body: DISCUSSIONS } });
    mockDiscussionAddNote(GITLAB_COM, {
      body: {
        id: 999,
        type: 'DiffNote',
        system: false,
        body: 'Me too.',
        author: {
          username: 'octocat',
          avatar_url: 'https://example.com/octo.png',
          bot: false,
        },
        created_at: '2026-09-01T10:00:00.000Z',
      },
    });
    const payload = await gitLabForge.comments.create(
      MR_PULL,
      { body: 'Me too.', replyToId: 602 },
      { token: TOKEN }
    );

    // The discussions lookup comes first, the POST lands on the thread that
    // holds the note, and the payload points back at the thread's root.
    const [lookup, post] = requests;
    assert.equal(lookup.method, 'GET');
    assert.equal(
      post.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/discussions/1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d/notes'
    );
    assert.deepEqual(post.body, { body: 'Me too.' });
    assertGitLabHeaders(post, { token: TOKEN });
    assert.equal(payload.remoteId, 999);
    assert.equal(payload.replyToId, 601);
    assert.equal(payload.body, 'Me too.');
  });

  it('answers a reply to a note no thread holds with a 404', async () => {
    mockMrDiscussions(GITLAB_COM, { 1: { body: DISCUSSIONS } });

    await expectGitHubError(
      gitLabForge.comments.create(
        MR_PULL,
        { body: 'Me too.', replyToId: 424242 },
        { token: TOKEN }
      ),
      { status: 404, message: { fragment: 'no longer there' } }
    );
    // The lookup, and no POST after it.
    assert.equal(requests.length, 1);
  });

  it('reads the diff refs, then posts a positioned note as form fields', async () => {
    mockMrShow(GITLAB_COM, { body: MR_SHOW });
    mockDiscussionCreate(GITLAB_COM, {
      // The endpoint answers a discussion; the note written is its first.
      body: {
        id: '9f3e2c1a',
        individual_note: false,
        notes: [
          {
            id: 1001,
            type: 'DiffNote',
            system: false,
            body: 'A note.',
            author: { username: 'octocat', bot: false },
            created_at: '2026-09-01T10:00:00.000Z',
            resolvable: true,
            resolved: false,
            position: {
              new_path: 'src/extension.ts',
              old_path: 'src/extension.ts',
              new_line: 42,
            },
          },
        ],
      },
    });
    const payload = await gitLabForge.comments.create(
      MR_PULL,
      {
        body: 'A note.',
        path: 'src/extension.ts',
        line: 42,
        side: 'additions',
      },
      { token: TOKEN }
    );

    // The MR read comes first; gitbeaker puts the position on the wire as
    // snake_case multipart form fields, the line as a string.
    const [show, post] = requests;
    assert.equal(
      show.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334'
    );
    assert.equal(post.method, 'POST');
    assert.equal(
      post.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/discussions'
    );
    assert.deepEqual(post.body, {
      body: 'A note.',
      'position[position_type]': 'text',
      'position[base_sha]': MR_SHOW.diff_refs.base_sha,
      'position[start_sha]': MR_SHOW.diff_refs.start_sha,
      'position[head_sha]': MR_SHOW.diff_refs.head_sha,
      'position[new_path]': 'src/extension.ts',
      'position[old_path]': 'src/extension.ts',
      'position[new_line]': '42',
    });
    assertGitLabHeaders(post, { token: TOKEN });
    assert.equal(payload.remoteId, 1001);
    assert.equal(payload.author, 'octocat');
    assert.equal(payload.body, 'A note.');
    assert.equal(payload.line, 42);
    assert.equal(payload.side, 'additions');
    // The discussion id the resolve call addresses travels with the payload,
    // the way the discussions read reports it.
    assert.equal(payload.threadId, '9f3e2c1a');
  });

  it('posts a ranged note from raw cursors, with the line codes GitLab requires', async () => {
    mockMrShow(GITLAB_COM, { body: MR_SHOW });
    mockDiscussionCreate(GITLAB_COM, {
      body: {
        id: 'b7c21f00',
        individual_note: false,
        notes: [
          {
            id: 1003,
            type: 'DiffNote',
            system: false,
            body: 'Ranged.',
            author: { username: 'octocat', bot: false },
            created_at: '2026-09-01T10:00:00.000Z',
            position: {
              new_path: 'src/new-name.ts',
              old_path: 'src/old-name.ts',
              old_line: 42,
            },
          },
        ],
      },
    });
    const payload = await gitLabForge.comments.create(
      MR_PULL,
      {
        body: 'Ranged.',
        path: 'src/new-name.ts',
        line: 42,
        side: 'deletions',
        gitlabPosition: {
          oldPath: 'src/old-name.ts',
          newPath: 'src/new-name.ts',
          start: { oldPos: 40, newPos: 44, kind: 'context' },
          end: { oldPos: 42, newPos: 46, kind: 'deletion' },
        },
      },
      { token: TOKEN }
    );

    // The rename is preserved on both paths, the context start sends both
    // coordinates, the deletion end only its own, and each range end carries
    // the line code — the SHA1 of the new path plus both raw cursors, the
    // hidden one included.
    const [, post] = requests;
    const hash = fileHash('src/new-name.ts');
    assert.deepEqual(post.body, {
      body: 'Ranged.',
      'position[position_type]': 'text',
      'position[base_sha]': MR_SHOW.diff_refs.base_sha,
      'position[start_sha]': MR_SHOW.diff_refs.start_sha,
      'position[head_sha]': MR_SHOW.diff_refs.head_sha,
      'position[new_path]': 'src/new-name.ts',
      'position[old_path]': 'src/old-name.ts',
      'position[old_line]': '42',
      'position[line_range][start][line_code]': `${hash}_40_44`,
      'position[line_range][start][type]': 'expanded',
      'position[line_range][start][old_line]': '40',
      'position[line_range][start][new_line]': '44',
      'position[line_range][end][line_code]': `${hash}_42_46`,
      'position[line_range][end][type]': 'old',
      'position[line_range][end][old_line]': '42',
    });
    assert.equal(payload.side, 'deletions');
    assert.equal(payload.author, 'octocat');
    assert.equal(payload.body, 'Ranged.');
  });

  it('posts a single-line note from raw cursors, with no range fields', async () => {
    mockMrShow(GITLAB_COM, { body: MR_SHOW });
    mockDiscussionCreate(GITLAB_COM, {
      body: {
        id: 'c4d81a22',
        individual_note: false,
        notes: [
          {
            id: 1004,
            type: 'DiffNote',
            system: false,
            body: 'A note.',
            author: { username: 'octocat', bot: false },
            created_at: '2026-09-01T10:00:00.000Z',
            position: {
              new_path: 'src/new-name.ts',
              old_path: 'src/old-name.ts',
              new_line: 42,
            },
          },
        ],
      },
    });
    const payload = await gitLabForge.comments.create(
      MR_PULL,
      {
        body: 'A note.',
        path: 'src/new-name.ts',
        line: 42,
        side: 'additions',
        gitlabPosition: {
          oldPath: 'src/old-name.ts',
          newPath: 'src/new-name.ts',
          end: { oldPos: 41, newPos: 42, kind: 'addition' },
        },
      },
      { token: TOKEN }
    );

    const [, post] = requests;
    assert.deepEqual(post.body, {
      body: 'A note.',
      'position[position_type]': 'text',
      'position[base_sha]': MR_SHOW.diff_refs.base_sha,
      'position[start_sha]': MR_SHOW.diff_refs.start_sha,
      'position[head_sha]': MR_SHOW.diff_refs.head_sha,
      'position[new_path]': 'src/new-name.ts',
      'position[old_path]': 'src/old-name.ts',
      'position[new_line]': '42',
    });
    assert.equal(payload.side, 'additions');
    assert.equal(payload.line, 42);
  });

  it('posts a context note with both coordinates', async () => {
    mockMrShow(GITLAB_COM, { body: MR_SHOW });
    mockDiscussionCreate(GITLAB_COM, {
      body: {
        id: 'd5e92b33',
        individual_note: false,
        notes: [
          {
            id: 1005,
            type: 'DiffNote',
            system: false,
            body: 'A context note.',
            author: { username: 'octocat', bot: false },
            created_at: '2026-09-01T10:00:00.000Z',
            position: {
              new_path: 'src/extension.ts',
              old_path: 'src/extension.ts',
              old_line: 10,
              new_line: 15,
            },
          },
        ],
      },
    });
    const payload = await gitLabForge.comments.create(
      MR_PULL,
      {
        body: 'A context note.',
        path: 'src/extension.ts',
        line: 15,
        side: 'additions',
        gitlabPosition: {
          oldPath: 'src/extension.ts',
          newPath: 'src/extension.ts',
          end: { oldPos: 10, newPos: 15, kind: 'context' },
        },
      },
      { token: TOKEN }
    );

    // GitLab asks both coordinates of a context position.
    const [, post] = requests;
    assert.deepEqual(post.body, {
      body: 'A context note.',
      'position[position_type]': 'text',
      'position[base_sha]': MR_SHOW.diff_refs.base_sha,
      'position[start_sha]': MR_SHOW.diff_refs.start_sha,
      'position[head_sha]': MR_SHOW.diff_refs.head_sha,
      'position[new_path]': 'src/extension.ts',
      'position[old_path]': 'src/extension.ts',
      'position[old_line]': '10',
      'position[new_line]': '15',
    });
    // And the answer maps back to the row it was written on: the old side,
    // the old number — the same row the writer clicked.
    assert.equal(payload.side, 'deletions');
    assert.equal(payload.line, 10);
  });

  it('keeps the scalar range shape for a caller without cursors', async () => {
    mockMrShow(GITLAB_COM, { body: MR_SHOW });
    mockDiscussionCreate(GITLAB_COM, {
      body: {
        id: 'a41b7d20',
        individual_note: false,
        notes: [
          {
            id: 1002,
            type: 'DiffNote',
            system: false,
            body: 'Ranged.',
            author: { username: 'octocat', bot: false },
            created_at: '2026-09-01T10:00:00.000Z',
            position: {
              new_path: 'src/transpile.ts',
              old_path: 'src/transpile.ts',
              old_line: 42,
              line_range: {
                start: { old_line: 40 },
                end: { old_line: 42 },
              },
            },
          },
        ],
      },
    });
    const payload = await gitLabForge.comments.create(
      MR_PULL,
      {
        body: 'Ranged.',
        path: 'src/transpile.ts',
        line: 42,
        side: 'deletions',
        startLine: 40,
        startSide: 'deletions',
      },
      { token: TOKEN }
    );

    // The legacy scalar path, cursors or no: one side's coordinate per end,
    // no line code.
    const [, post] = requests;
    assert.deepEqual(post.body, {
      body: 'Ranged.',
      'position[position_type]': 'text',
      'position[base_sha]': MR_SHOW.diff_refs.base_sha,
      'position[start_sha]': MR_SHOW.diff_refs.start_sha,
      'position[head_sha]': MR_SHOW.diff_refs.head_sha,
      'position[new_path]': 'src/transpile.ts',
      'position[old_path]': 'src/transpile.ts',
      'position[old_line]': '42',
      'position[line_range][start][type]': 'old',
      'position[line_range][start][old_line]': '40',
      'position[line_range][end][type]': 'old',
      'position[line_range][end][old_line]': '42',
    });
    assert.equal(payload.side, 'deletions');
    assert.equal(payload.startLine, 40);
    assert.equal(payload.startSide, 'deletions');
  });

  it('turns a merge request without diff refs into a 502', async () => {
    mockMrShow(GITLAB_COM, { body: { id: 1 } });

    await expectGitHubError(
      gitLabForge.comments.create(
        MR_PULL,
        { body: 'A note.', path: 'src/x.ts', line: 1, side: 'additions' },
        { token: TOKEN }
      ),
      {
        status: 502,
        message: { fragment: 'did not name this merge request’s diff' },
      }
    );
    // The MR read, and no POST after it.
    assert.equal(requests.length, 1);
  });
});

describe('comments.remove', () => {
  it('deletes by the note path', async () => {
    mockMrNoteRemove(GITLAB_COM);
    await gitLabForge.comments.remove(REPO_9_PULL, 55, { token: TOKEN });

    assert.equal(requests.length, 1);
    const [call] = requests;
    assert.equal(call.method, 'DELETE');
    assert.equal(
      call.path,
      '/api/v4/projects/group%2Frepo/merge_requests/9/notes/55'
    );
    assertGitLabHeaders(call, { token: TOKEN });
  });
});

describe('comments.resolve', () => {
  const THREAD_ID = '9c8b7a6f5e4d3c2b1a09f8e7d6c5b4a3';

  it('puts the resolved flag on the discussion path', async () => {
    mockDiscussionResolve(GITLAB_COM);
    await gitLabForge.comments.resolve?.(
      REPO_9_PULL,
      { threadId: THREAD_ID, resolved: true },
      { token: TOKEN }
    );

    assert.equal(requests.length, 1);
    const [call] = requests;
    assert.equal(call.method, 'PUT');
    assert.equal(
      call.path,
      `/api/v4/projects/group%2Frepo/merge_requests/9/discussions/${THREAD_ID}`
    );
    assert.equal(call.query.resolved, 'true');
    assertGitLabHeaders(call, { token: TOKEN });
  });

  it('sends false to take the mark back', async () => {
    mockDiscussionResolve(GITLAB_COM);
    await gitLabForge.comments.resolve?.(
      REPO_9_PULL,
      { threadId: THREAD_ID, resolved: false },
      { token: TOKEN }
    );

    const [call] = requests;
    assert.equal(call.query.resolved, 'false');
  });

  it('surfaces the instance’s own sentence when it refuses', async () => {
    mockDiscussionResolve(GITLAB_COM, {
      body: { message: 'You are not allowed to resolve this discussion' },
      status: 403,
    });

    await expectGitHubError(
      gitLabForge.comments.resolve!(
        REPO_9_PULL,
        { threadId: THREAD_ID, resolved: true },
        { token: TOKEN }
      ),
      {
        status: 403,
        message: 'You are not allowed to resolve this discussion',
      }
    );
  });
});

describe('reviews.mine', () => {
  it('answers with nothing and asks nothing without a token', async () => {
    const review = await gitLabForge.reviews.mine(MR_PULL, {});
    assert.equal(review, undefined);
    assert.equal(requests.length, 0);
  });

  it('reads the recorded approvals when the viewer approved', async () => {
    // Hand-shaped, as every GraphQL answer here is. The approvers are the
    // recorded ones, and ohoral is the username they record.
    mockGraphQL(
      GITLAB_COM,
      graphQLRoute([
        'MyMergeRequestApproval',
        () => ({
          currentUser: { username: 'ohoral' },
          project: {
            mergeRequest: {
              approvedBy: {
                nodes: APPROVALS.approved_by.map((entry) => ({
                  username: entry.user?.username,
                })),
              },
            },
          },
        }),
      ])
    );
    const review = await gitLabForge.reviews.mine(MR_PULL, { token: TOKEN });

    assert.deepEqual(review, {
      id: 0,
      state: 'APPROVED',
      htmlUrl:
        'https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/merge_requests/3334',
    });
    const [call] = graphQLCallsTo(GITLAB_COM);
    assert.deepEqual(call.variables, { path: PROJECT, iid: '3334' });
    assertGitLabHeaders(requests[0], { token: TOKEN });
  });

  it('answers with nothing when the viewer has not approved', async () => {
    mockGraphQL(
      GITLAB_COM,
      graphQLRoute([
        'MyMergeRequestApproval',
        () => ({
          currentUser: { username: 'ghost' },
          project: {
            mergeRequest: {
              approvedBy: {
                nodes: APPROVALS.approved_by.map((entry) => ({
                  username: entry.user?.username,
                })),
              },
            },
          },
        }),
      ])
    );
    const review = await gitLabForge.reviews.mine(MR_PULL, { token: TOKEN });

    assert.equal(review, undefined);
    assert.equal(graphQLCallsTo(GITLAB_COM).length, 1);
  });
});

describe('reviews.submit', () => {
  it('posts an approval and says APPROVED', async () => {
    mockDraftNotes(GITLAB_COM, { 1: { body: [] } });
    mockApprove(GITLAB_COM, { body: {} });
    const review = await gitLabForge.reviews.submit(
      MR_PULL,
      { event: 'APPROVE' },
      { token: TOKEN }
    );

    assert.deepEqual(review, {
      id: 0,
      state: 'APPROVED',
      htmlUrl:
        'https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/merge_requests/3334',
    });
    // The drafts read, then the approval.
    assert.equal(requests.length, 2);
    const [list, post] = requests;
    assert.equal(
      list.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/draft_notes'
    );
    assert.equal(
      post.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/approve'
    );
    assertGitLabHeaders(post, { token: TOKEN });
  });

  it('refuses a comment with no words when nothing is staged', async () => {
    mockDraftNotes(GITLAB_COM, { 1: { body: [] } });
    await expectGitHubError(
      gitLabForge.reviews.submit(
        MR_PULL,
        { event: 'COMMENT', body: '   ' },
        { token: TOKEN }
      ),
      { status: 400, message: { fragment: 'needs words' } }
    );
    // The drafts read is all that was asked.
    assert.equal(requests.length, 1);
  });

  it('posts a comment as a plain note and says COMMENTED', async () => {
    mockDraftNotes(GITLAB_COM, { 1: { body: [] } });
    mockMrNoteCreate(GITLAB_COM, {
      body: {
        id: 777,
        body: 'Looks right.',
        author: { username: 'octocat' },
        created_at: '2026-09-01T10:00:00.000Z',
      },
    });
    const review = await gitLabForge.reviews.submit(
      MR_PULL,
      { event: 'COMMENT', body: '  Looks right.  ' },
      { token: TOKEN }
    );

    assert.deepEqual(review, {
      id: 777,
      state: 'COMMENTED',
      submittedAt: '2026-09-01T10:00:00.000Z',
      htmlUrl:
        'https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/merge_requests/3334#note_777',
    });
    assert.equal(requests.length, 2);
    const [, post] = requests;
    assert.equal(
      post.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/notes'
    );
    assert.deepEqual(post.body, { body: 'Looks right.' });
    assertGitLabHeaders(post, { token: TOKEN });
  });

  it('publishes the drafts and posts the body as its own note', async () => {
    mockDraftNotes(GITLAB_COM, { 1: { body: [DRAFT_NOTE] } });
    mockDraftNotesBulkPublish(GITLAB_COM, { body: [] });
    mockMrNoteCreate(GITLAB_COM, {
      body: {
        id: 777,
        body: 'Looks right.',
        author: { username: 'octocat' },
        created_at: '2026-09-01T10:00:00.000Z',
      },
    });
    const review = await gitLabForge.reviews.submit(
      MR_PULL,
      { event: 'COMMENT', body: '  Looks right.  ' },
      { token: TOKEN }
    );

    const [list, publish, note] = requests;
    assert.equal(list.method, 'GET');
    assert.equal(
      publish.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/draft_notes/bulk_publish'
    );
    // The publish carries no `note`: an instance may ignore that param, and
    // a body that rides only there is a body silently lost.
    assert.equal(
      (publish.body as { note?: string } | undefined)?.note,
      undefined
    );
    assertGitLabHeaders(publish, { token: TOKEN });
    assert.equal(
      note.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/notes'
    );
    assert.deepEqual(note.body, { body: 'Looks right.' });
    assert.equal(review.state, 'COMMENTED');
    assert.equal(review.id, 777);
    assert.equal(
      review.htmlUrl,
      'https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/merge_requests/3334#note_777'
    );
  });

  it('posts no note when the body is empty', async () => {
    mockDraftNotes(GITLAB_COM, { 1: { body: [DRAFT_NOTE] } });
    mockDraftNotesBulkPublish(GITLAB_COM, { body: [] });
    const review = await gitLabForge.reviews.submit(
      MR_PULL,
      { event: 'COMMENT', body: '   ' },
      { token: TOKEN }
    );

    assert.equal(
      requestsTo(
        GITLAB_COM,
        '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/notes'
      ).length,
      0
    );
    assert.equal(review?.state, 'COMMENTED');
  });

  it('approves before the summary note when the verdict is APPROVE', async () => {
    mockDraftNotes(GITLAB_COM, { 1: { body: [DRAFT_NOTE] } });
    mockDraftNotesBulkPublish(GITLAB_COM, { body: [] });
    mockMrNoteCreate(GITLAB_COM, {
      body: { id: 778, body: 'Ship it.', author: { username: 'octocat' } },
    });
    mockApprove(GITLAB_COM, { body: {} });
    const review = await gitLabForge.reviews.submit(
      MR_PULL,
      { event: 'APPROVE', body: 'Ship it.' },
      { token: TOKEN }
    );

    assert.deepEqual(review, {
      id: 0,
      state: 'APPROVED',
      htmlUrl:
        'https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/merge_requests/3334',
    });
    // The approval lands before the summary: a failed approval retried never
    // duplicates the note.
    const [, publish, approve, note] = requests;
    assert.equal(
      publish.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/draft_notes/bulk_publish'
    );
    assert.equal(
      (publish.body as { note?: string } | undefined)?.note,
      undefined
    );
    assert.equal(
      approve.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/approve'
    );
    assert.equal(
      note.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/notes'
    );
    assert.deepEqual(note.body, { body: 'Ship it.' });
  });

  it('posts no summary before the approval, so the retry lands one', async () => {
    // The first approval fails: the summary note must not have gone up, or
    // the retry that follows would write it a second time.
    mockDraftNotes(GITLAB_COM, { 1: { body: [] } });
    mockApprove(GITLAB_COM, {
      status: 500,
      body: { message: 'Something went wrong' },
    });
    const notesPath =
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/notes';
    await expectGitHubError(
      gitLabForge.reviews.submit(
        MR_PULL,
        { event: 'APPROVE', body: 'Ship it.' },
        { token: TOKEN }
      ),
      { status: 500, message: 'Something went wrong' }
    );
    assert.equal(requestsTo(GITLAB_COM, notesPath).length, 0);

    // The retry: the approval stands, and exactly one summary exists.
    mockApprove(GITLAB_COM, { body: {} });
    mockMrNoteCreate(GITLAB_COM, {
      body: { id: 779, body: 'Ship it.', author: { username: 'octocat' } },
    });
    const review = await gitLabForge.reviews.submit(
      MR_PULL,
      { event: 'APPROVE', body: 'Ship it.' },
      { token: TOKEN }
    );

    assert.equal(review.state, 'APPROVED');
    assert.equal(requestsTo(GITLAB_COM, notesPath).length, 1);
  });

  it('takes a repeated approval as the success it is', async () => {
    // The instance answers a repeated approval with a bare 401 even though
    // the approval stands — its own eligibility rule. The state is read
    // back, and the viewer's presence in it answers for the press.
    mockDraftNotes(GITLAB_COM, { 1: { body: [] } });
    mockApprove(GITLAB_COM, {
      status: 401,
      body: { message: '401 Unauthorized' },
    });
    mockGetUser(GITLAB_COM, {
      body: { username: 'ohoral', avatar_url: null, name: 'Olena' },
    });
    mockApprovals(GITLAB_COM, { 3334: { body: APPROVALS } });
    const review = await gitLabForge.reviews.submit(
      MR_PULL,
      { event: 'APPROVE' },
      { token: TOKEN }
    );

    assert.deepEqual(review, {
      id: 0,
      state: 'APPROVED',
      htmlUrl:
        'https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/merge_requests/3334',
    });
    const [, approve, user, configuration] = requests;
    assert.equal(
      approve.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/approve'
    );
    assert.equal(user.path, '/api/v4/user');
    assert.equal(
      configuration.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/approvals'
    );
  });

  it('rethrows a 401 the approval state does not explain', async () => {
    // A 401 without the viewer in `approved_by` is the real one: the
    // instance refused the approval, nothing landed.
    mockDraftNotes(GITLAB_COM, { 1: { body: [] } });
    mockApprove(GITLAB_COM, {
      status: 401,
      body: { message: '401 Unauthorized' },
    });
    mockGetUser(GITLAB_COM, {
      body: { username: 'ghost', avatar_url: null, name: null },
    });
    mockApprovals(GITLAB_COM, { 3334: { body: APPROVALS } });

    await expectGitHubError(
      gitLabForge.reviews.submit(
        MR_PULL,
        { event: 'APPROVE' },
        { token: TOKEN }
      ),
      { status: 401, message: '401 Unauthorized' }
    );
  });

  it('names the likely cause when the publish fails with a 500', async () => {
    mockDraftNotes(GITLAB_COM, { 1: { body: [DRAFT_NOTE] } });
    mockDraftNotesBulkPublish(GITLAB_COM, {
      body: { message: 'Something went wrong' },
      status: 500,
    });

    await expectGitHubError(
      gitLabForge.reviews.submit(
        MR_PULL,
        { event: 'COMMENT', body: 'Looks right.' },
        { token: TOKEN }
      ),
      { status: 502, message: { fragment: 'outside the diff' } }
    );
    // Nothing was deleted and no verdict went up: the staging survives for
    // the retry.
    assert.equal(
      requests.filter((record) => record.method === 'DELETE').length,
      0
    );
    assert.equal(
      requestsTo(
        GITLAB_COM,
        '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/approve'
      ).length,
      0
    );
    assert.equal(
      requestsTo(
        GITLAB_COM,
        '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/notes'
      ).length,
      0
    );
  });
});

// Hand-shaped: the draft-notes endpoints answer only for a credential. The
// field names are GitLab's own — the note's text is `note`, and the position
// is the one a discussion's note carries.
const DRAFT_NOTE = {
  id: 42,
  note: 'This reads as if the flag defaults on.',
  position: {
    new_path: 'src/extension.ts',
    old_path: 'src/extension.ts',
    new_line: 42,
  },
};

describe('drafts.list', () => {
  it('maps the drafts to staged payloads authored by the credential', async () => {
    mockDraftNotes(GITLAB_COM, { 1: { body: [DRAFT_NOTE] } });
    mockGetUser(GITLAB_COM, {
      body: {
        username: 'octocat',
        avatar_url: 'https://example.com/octo.png',
      },
    });
    const drafts = await gitLabForge.drafts?.list(MR_PULL, { token: TOKEN });

    assert.deepEqual(drafts, [
      {
        remoteId: 42,
        path: 'src/extension.ts',
        author: 'octocat',
        authorAvatarUrl: 'https://example.com/octo.png',
        authorIsBot: false,
        body: 'This reads as if the flag defaults on.',
        createdAt: undefined,
        htmlUrl:
          'https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/merge_requests/3334#note_42',
        replyToId: undefined,
        line: 42,
        side: 'additions',
        staged: true,
      },
    ]);
    const [list, user] = requests;
    assert.equal(
      list.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/draft_notes'
    );
    assert.equal(user.path, '/api/v4/user');
    assertGitLabHeaders(list, { token: TOKEN });
  });

  it('answers an empty list without asking who the credential is', async () => {
    // Empty is the common case, and it has nobody to author: the /user read
    // would be one wasted call per merge-request load.
    mockDraftNotes(GITLAB_COM, { 1: { body: [] } });
    const drafts = await gitLabForge.drafts?.list(MR_PULL, { token: TOKEN });

    assert.deepEqual(drafts, []);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests/3334/draft_notes'
    );
  });

  it('answers an empty list without a token and asks nothing', async () => {
    const drafts = await gitLabForge.drafts?.list(MR_PULL, {});
    assert.deepEqual(drafts, []);
    assert.equal(requests.length, 0);
  });
});

describe('drafts.create', () => {
  it('reads the diff refs, then posts the draft with the position', async () => {
    mockMrShow(GITLAB_COM, { body: MR_SHOW });
    mockDraftNoteCreate(GITLAB_COM, { body: { id: 43, note: 'A draft.' } });
    mockGetUser(GITLAB_COM, {
      body: {
        username: 'octocat',
        avatar_url: 'https://example.com/octo.png',
      },
    });
    const payload = await gitLabForge.drafts?.create(
      MR_PULL,
      {
        body: 'A draft.',
        path: 'src/extension.ts',
        line: 42,
        side: 'additions',
      },
      { token: TOKEN }
    );

    const post = requests.find((record) =>
      record.path.endsWith('/draft_notes')
    );
    const show = requests.find((record) =>
      record.path.endsWith('/merge_requests/3334')
    );
    const user = requests.find((record) => record.path === '/api/v4/user');
    assert.ok(show != null && post != null && user != null);
    // Unlike a discussion's position, a draft note's travels as JSON.
    assert.deepEqual(post.body, {
      note: 'A draft.',
      position: {
        position_type: 'text',
        base_sha: MR_SHOW.diff_refs.base_sha,
        start_sha: MR_SHOW.diff_refs.start_sha,
        head_sha: MR_SHOW.diff_refs.head_sha,
        new_path: 'src/extension.ts',
        old_path: 'src/extension.ts',
        new_line: '42',
      },
    });
    assertGitLabHeaders(post, { token: TOKEN });
    // The answer carried no position, so the payload keeps the one it was
    // written with.
    assert.equal(payload?.remoteId, 43);
    assert.equal(payload?.staged, true);
    assert.equal(payload?.path, 'src/extension.ts');
    assert.equal(payload?.line, 42);
    assert.equal(payload?.side, 'additions');
    assert.equal(payload?.body, 'A draft.');
    // Nor an author, so the payload is authored by the credential's own user.
    assert.equal(payload?.author, 'octocat');
    assert.equal(payload?.authorAvatarUrl, 'https://example.com/octo.png');
  });

  it('posts a draft from raw cursors, preserving the rename and the range', async () => {
    mockMrShow(GITLAB_COM, { body: MR_SHOW });
    mockDraftNoteCreate(GITLAB_COM, { body: { id: 44, note: 'A draft.' } });
    mockGetUser(GITLAB_COM, {
      body: {
        username: 'octocat',
        avatar_url: 'https://example.com/octo.png',
      },
    });
    const payload = await gitLabForge.drafts?.create(
      MR_PULL,
      {
        body: 'A draft.',
        path: 'src/new-name.ts',
        line: 25,
        side: 'additions',
        gitlabPosition: {
          oldPath: 'src/old-name.ts',
          newPath: 'src/new-name.ts',
          start: { oldPos: 18, newPos: 23, kind: 'addition' },
          end: { oldPos: 20, newPos: 25, kind: 'addition' },
        },
      },
      { token: TOKEN }
    );

    const post = requests.find((record) =>
      record.path.endsWith('/draft_notes')
    );
    assert.ok(post != null);
    // A draft note's position travels as JSON: the same spelling the
    // discussion create sends as form fields, range ends with their line
    // codes.
    const hash = fileHash('src/new-name.ts');
    assert.deepEqual(post.body, {
      note: 'A draft.',
      position: {
        position_type: 'text',
        base_sha: MR_SHOW.diff_refs.base_sha,
        start_sha: MR_SHOW.diff_refs.start_sha,
        head_sha: MR_SHOW.diff_refs.head_sha,
        new_path: 'src/new-name.ts',
        old_path: 'src/old-name.ts',
        new_line: '25',
        line_range: {
          start: {
            line_code: `${hash}_18_23`,
            type: 'new',
            new_line: 23,
          },
          end: {
            line_code: `${hash}_20_25`,
            type: 'new',
            new_line: 25,
          },
        },
      },
    });
    assertGitLabHeaders(post, { token: TOKEN });
    // The answer carried no position, so the payload keeps the one it was
    // written with.
    assert.equal(payload?.remoteId, 44);
    assert.equal(payload?.staged, true);
    assert.equal(payload?.path, 'src/new-name.ts');
    assert.equal(payload?.side, 'additions');
    assert.equal(payload?.line, 25);
  });
});

describe('drafts.remove', () => {
  it('deletes by the draft-note path', async () => {
    mockDraftNoteRemove(GITLAB_COM);
    await gitLabForge.drafts?.remove(REPO_9_PULL, { id: 42 }, { token: TOKEN });

    assert.equal(requests.length, 1);
    const [call] = requests;
    assert.equal(call.method, 'DELETE');
    assert.equal(
      call.path,
      '/api/v4/projects/group%2Frepo/merge_requests/9/draft_notes/42'
    );
    assertGitLabHeaders(call, { token: TOKEN });
  });
});

// Mutated copies of the recorded page: `head_pipeline` is absent in the real
// payloads, so the four statuses the matrix needs are set here.
const PIPELINE_BY_IID: Record<number, string> = {
  3341: 'success',
  3340: 'failed',
  3339: 'running',
  3336: 'canceled',
};
const LIST_WITH_PIPELINES = MR_LIST.map((mr) => {
  const status = PIPELINE_BY_IID[mr.iid];
  return status == null ? mr : { ...mr, head_pipeline: { status } };
});

/**
 * A merge request as the GraphQL read carries it, mapped from the recorded
 * REST page: the iid is a string, the pipeline status is uppercased, and the
 * approval state is the one field the hand-shaped answers decide —
 * `undefined` writes a null `approvedBy`, the field-level failure the row
 * must survive.
 */
function graphQLMr(
  mr: GitLabMergeRequestJson,
  approved?: boolean
): Record<string, unknown> {
  return {
    iid: String(mr.iid),
    title: mr.title,
    draft: mr.draft,
    webUrl: mr.web_url,
    updatedAt: mr.updated_at,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
    author:
      mr.author == null
        ? null
        : { username: mr.author.username, avatarUrl: mr.author.avatar_url },
    headPipeline:
      mr.head_pipeline?.status == null
        ? null
        : { status: mr.head_pipeline.status.toUpperCase() },
    approvedBy:
      approved == null
        ? null
        : { nodes: approved ? [{ id: 'gid://gitlab/User/1' }] : [] },
  };
}

const GITLAB_REPO: RepoRef = {
  forge: 'gitlab',
  host: GITLAB_COM,
  project: PROJECT,
};

/** The calls to one endpoint, by exact path. */
function callsTo(path: string) {
  return requests.filter((record) => record.path === path);
}

describe('listOpenPulls', () => {
  it('maps real open merge requests, and keeps a project that 404s beside them', async () => {
    mockMrList(GITLAB_COM, {
      [PROJECT]: { body: MR_LIST },
      'ghdiff-bogus/nope': { body: PROJECT_404, status: 404 },
    });
    const result = await gitLabForge.listOpenPulls(
      [
        GITLAB_REPO,
        { forge: 'gitlab', host: GITLAB_COM, project: 'ghdiff-bogus/nope' },
      ],
      {}
    );

    assert.equal(result.viewer, undefined);
    assert.deepEqual(result.failures, [
      {
        repo: 'gitlab.com:ghdiff-bogus/nope',
        message: '404 Project Not Found',
      },
    ]);
    assert.equal(result.pulls.length, MR_LIST.length);
    const first = result.pulls[0];
    assert.equal(first.owner, GITLAB_COM);
    assert.equal(first.repo, PROJECT);
    assert.equal(first.forge, 'gitlab');
    assert.equal(first.host, GITLAB_COM);
    assert.equal(first.project, PROJECT);
    assert.equal(first.number, 3341);
    assert.equal(first.author, 'gitlab-dependency-update-bot');
    assert.equal(first.state, 'open');
    assert.equal(
      first.htmlUrl,
      'https://gitlab.com/gitlab-org/gitlab-vscode-extension/-/merge_requests/3341'
    );
    assert.equal(first.headRef, 'renovate/opentelemetry');
    assert.equal(first.baseRef, 'main');
    // The recorded draft reads as a draft.
    assert.equal(
      result.pulls.find((pull) => pull.number === 3336)?.state,
      'draft'
    );
    // No token: no status, and neither call it would have cost.
    assert.equal(first.status, undefined);
    assert.equal(callsTo('/api/v4/user').length, 0);
    assert.equal(
      requests.filter((record) => record.path.endsWith('/approvals')).length,
      0
    );

    const [listCall] = callsTo(
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests'
    );
    assert.deepEqual(listCall.query, {
      state: 'opened',
      order_by: 'updated_at',
      sort: 'desc',
      per_page: '100',
    });
    assertGitLabHeaders(listCall);
  });

  it('reads the approvals and the pipeline when there is a token', async () => {
    // Hand-shaped, as every GraphQL answer here is: the recorded page with
    // 3341 approved and the pipeline matrix above.
    mockGraphQL(
      GITLAB_COM,
      graphQLRoute([
        'OpenMergeRequests',
        () => ({
          currentUser: { username: 'octocat' },
          project: {
            mergeRequests: {
              nodes: LIST_WITH_PIPELINES.map((mr) =>
                graphQLMr(mr, mr.iid === 3341)
              ),
            },
          },
        }),
      ])
    );
    const result = await gitLabForge.listOpenPulls([GITLAB_REPO], {
      token: TOKEN,
    });

    assert.equal(result.viewer, 'octocat');
    assert.deepEqual(result.failures, []);
    const byNumber = new Map(result.pulls.map((pull) => [pull.number, pull]));
    assert.deepEqual(byNumber.get(3341)?.status, {
      review: 'approved',
      check: 'success',
    });
    assert.deepEqual(byNumber.get(3340)?.status, {
      review: 'none',
      check: 'failure',
    });
    assert.deepEqual(byNumber.get(3339)?.status, {
      review: 'none',
      check: 'pending',
    });
    assert.deepEqual(byNumber.get(3336)?.status, {
      review: 'none',
      check: 'none',
    });
    // The recorded page carries no pipeline: that half reads as no mark.
    assert.deepEqual(byNumber.get(3335)?.status, {
      review: 'none',
      check: 'none',
    });

    const [call] = graphQLCallsTo(GITLAB_COM);
    assert.deepEqual(call.variables, { path: PROJECT, first: 100 });
    assertGitLabHeaders(requests[0], { token: TOKEN });
  });

  it('marks the merge requests asking for the viewer’s review', async () => {
    // Hand-shaped like the axes above: presence in the reviewers list is what
    // the instance's own "requested to review" means, and the username matches
    // without case.
    mockGraphQL(
      GITLAB_COM,
      graphQLRoute([
        'OpenMergeRequests',
        () => ({
          currentUser: { username: 'octocat' },
          project: {
            mergeRequests: {
              nodes: [
                {
                  ...graphQLMr(LIST_WITH_PIPELINES[0], false),
                  reviewers: { nodes: [{ username: 'OctoCat' }] },
                },
                {
                  ...graphQLMr(LIST_WITH_PIPELINES[1], false),
                  reviewers: { nodes: [{ username: 'someone-else' }] },
                },
              ],
            },
          },
        }),
      ])
    );
    const result = await gitLabForge.listOpenPulls([GITLAB_REPO], {
      token: TOKEN,
    });

    const byNumber = new Map(result.pulls.map((pull) => [pull.number, pull]));
    assert.equal(byNumber.get(3341)?.reviewRequested, true);
    assert.equal(byNumber.get(3340)?.reviewRequested, undefined);
  });

  it('loses the review axis and not the row when the approval read fails', async () => {
    // A token the instance will not show approvals to gets a null
    // `approvedBy` on that merge request — the pipeline still says its half.
    mockGraphQL(
      GITLAB_COM,
      graphQLRoute([
        'OpenMergeRequests',
        () => ({
          currentUser: { username: 'octocat' },
          project: {
            mergeRequests: {
              nodes: LIST_WITH_PIPELINES.map((mr) =>
                graphQLMr(mr, mr.iid === 3340 ? undefined : mr.iid === 3341)
              ),
            },
          },
        }),
      ])
    );
    const result = await gitLabForge.listOpenPulls([GITLAB_REPO], {
      token: TOKEN,
    });

    assert.deepEqual(result.failures, []);
    const byNumber = new Map(result.pulls.map((pull) => [pull.number, pull]));
    assert.deepEqual(byNumber.get(3340)?.status, {
      review: 'none',
      check: 'failure',
    });
    // The merge requests beside it keep both halves.
    assert.deepEqual(byNumber.get(3341)?.status, {
      review: 'approved',
      check: 'success',
    });
  });

  it('reports a project the token cannot see as a failure row', async () => {
    // A 200 with a null project — GraphQL's answer to an invisible one.
    mockGraphQL(
      GITLAB_COM,
      graphQLRoute(['OpenMergeRequests', () => ({ project: null })])
    );
    const result = await gitLabForge.listOpenPulls([GITLAB_REPO], {
      token: TOKEN,
    });

    assert.deepEqual(result.pulls, []);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.repo, `gitlab.com:${PROJECT}`);
    assert.match(result.failures[0]?.message ?? '', /no such project/);
  });

  it('asks each host for its own projects', async () => {
    mockGraphQL(
      GITLAB_COM,
      graphQLRoute([
        'OpenMergeRequests',
        () => ({
          currentUser: { username: 'octocat' },
          project: {
            mergeRequests: { nodes: MR_LIST.map((mr) => graphQLMr(mr, false)) },
          },
        }),
      ])
    );
    // Hand-shaped: the corp instance is a stand-in, so its one merge request
    // is written here in the shape the read returns.
    mockGraphQL(
      GITLAB_CORP,
      graphQLRoute([
        'OpenMergeRequests',
        () => ({
          currentUser: { username: 'corp-dev' },
          project: {
            mergeRequests: {
              nodes: [
                {
                  iid: '7',
                  title: 'A corp merge request',
                  draft: false,
                  webUrl:
                    'https://gitlab.corp.com/group/repo/-/merge_requests/7',
                  updatedAt: '2026-09-01T00:00:00.000Z',
                  sourceBranch: 'feature',
                  targetBranch: 'main',
                  author: { username: 'corp-dev', avatarUrl: null },
                  headPipeline: { status: 'SUCCESS' },
                  approvedBy: { nodes: [] },
                },
              ],
            },
          },
        }),
      ])
    );
    const result = await gitLabForge.listOpenPulls(
      [
        GITLAB_REPO,
        { forge: 'gitlab', host: GITLAB_CORP, project: 'group/repo' },
      ],
      { token: TOKEN }
    );

    const corpPull = result.pulls.find((pull) => pull.host === GITLAB_CORP);
    assert.equal(corpPull?.owner, GITLAB_CORP);
    assert.equal(corpPull?.project, 'group/repo');
    assert.equal(corpPull?.number, 7);
    assert.deepEqual(corpPull?.status, { review: 'none', check: 'success' });

    const [corpCall] = graphQLCallsTo(GITLAB_CORP);
    assert.deepEqual(corpCall.variables, { path: 'group/repo', first: 100 });
    const [comCall] = graphQLCallsTo(GITLAB_COM);
    assert.deepEqual(comCall.variables, { path: PROJECT, first: 100 });
    for (const record of requests) {
      assertGitLabHeaders(record, { token: TOKEN });
    }
  });

  it('stops at a full page rather than follow a next one', async () => {
    // Hand-shaped: the recorded page repeated to the hundred the cap sits
    // at, with the `link` header GitLab answers a next page with. Without a
    // token there is no viewer read and no approval read, so the list calls
    // are all that is left to count.
    const fullPage = Array.from({ length: 20 }, () => MR_LIST).flat();
    mockMrList(GITLAB_COM, {
      [PROJECT]: {
        1: {
          body: fullPage,
          headers: {
            link: `<https://${GITLAB_COM}/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests?page=2&per_page=100>; rel="next"`,
          },
        },
        2: { body: [] },
      },
    });
    const result = await gitLabForge.listOpenPulls([GITLAB_REPO], {});

    assert.equal(result.pulls.length, 100);
    const listCalls = callsTo(
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/merge_requests'
    );
    assert.equal(listCalls.length, 1);
    assert.equal(listCalls[0].query.page, undefined);
  });
});

describe('error mapping', () => {
  it('reads an error key when the body carries no message', async () => {
    // Hand-shaped: some endpoints answer a failure with `error` rather than
    // `message` — the OAuth shape, which parts of the API share.
    mockCommitDiff(GITLAB_COM, {
      1: { body: { error: 'invalid sha' }, status: 400 },
    });

    await expectGitHubError(callDiff(gitLabForge, COMMIT_TARGET, {}), {
      status: 400,
      message: 'invalid sha',
    });
  });

  it('surfaces a non-JSON body as it arrived', async () => {
    // A proxy in front of the instance answers in its own words, and those
    // words are better than the status name.
    mockFileRaw(GITLAB_COM, { status: 502, body: 'Bad gateway' });

    await expectGitHubError(gitLabForge.file(COMMIT_TARGET, 'gone.ts', {}), {
      status: 502,
      message: 'Bad gateway',
    });
  });
});

describe('credentials', () => {
  it('sends a bearer token on the hand-rolled and the gitbeaker calls alike', async () => {
    mockMrRawDiffs(GITLAB_COM, {
      status: 404,
      body: jsonBody(PROJECT_404),
      headers: JSON_CONTENT_TYPE,
    });
    mockMrDiffs(GITLAB_COM, { 1: { body: MR_DIFFS } });
    mockMrShow(GITLAB_COM, { body: MR_SHOW });
    await callDiff(gitLabForge, MR_TARGET, { token: TOKEN });

    assert.equal(requests.length, 3);
    for (const call of requests) {
      assertGitLabHeaders(call, { token: TOKEN });
    }
  });

  it('sends a private token as private-token on both call paths', async () => {
    mockMrRawDiffs(GITLAB_COM, {
      status: 404,
      body: jsonBody(PROJECT_404),
      headers: JSON_CONTENT_TYPE,
    });
    mockMrDiffs(GITLAB_COM, { 1: { body: MR_DIFFS } });
    mockMrShow(GITLAB_COM, { body: MR_SHOW });
    await callDiff(gitLabForge, MR_TARGET, {
      token: TOKEN,
      scheme: 'private-token',
    });

    assert.equal(requests.length, 3);
    for (const call of requests) {
      assertGitLabHeaders(call, { token: TOKEN, scheme: 'private-token' });
    }
  });
});

describe('hosts and encoding', () => {
  it('encodes the project path exactly once, on the host the target names', async () => {
    const target: GitLabTarget = {
      kind: 'gitlab-mr',
      host: GITLAB_CORP,
      project: 'group/sub/repo',
      number: 7,
    };
    mockMrRawDiffs(GITLAB_CORP, { body: RAW_DIFFS });
    const response = await callDiff(gitLabForge, target, {});

    assert.equal(await response.text(), RAW_DIFFS);
    const [call] = requestsTo(
      GITLAB_CORP,
      '/api/v4/projects/group%2Fsub%2Frepo/merge_requests/7/raw_diffs'
    );
    assert.equal(call.host, GITLAB_CORP);
    assertGitLabHeaders(call);
    assert.equal(requestsTo(GITLAB_COM).length, 0);
  });

  it('encodes a nested file path exactly once', async () => {
    mockFileRaw(GITLAB_COM, { body: FILE_TEXT });
    await gitLabForge.file(
      COMMIT_TARGET,
      'scripts/transpile_es_to_cjs_for_integration_tests.mjs',
      {}
    );

    assert.equal(
      requests[0].path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension/repository/files/scripts%2Ftranspile_es_to_cjs_for_integration_tests.mjs/raw'
    );
  });
});

describe('gitLabProjectVisible', () => {
  it('answers true when the host shows the project, anonymously', async () => {
    mockProjectShow(GITLAB_COM, { body: { id: 1 } });

    assert.equal(await gitLabProjectVisible(GITLAB_COM, PROJECT, {}), true);

    const [call] = requests;
    assert.equal(
      call.path,
      '/api/v4/projects/gitlab-org%2Fgitlab-vscode-extension'
    );
    assertGitLabHeaders(call);
  });

  it('asks with the session’s bearer grant for the host', async () => {
    mockProjectShow(GITLAB_COM, { body: { id: 1 } });

    assert.equal(
      await gitLabProjectVisible(GITLAB_COM, PROJECT, { token: TOKEN }),
      true
    );

    assertGitLabHeaders(requests[0], { token: TOKEN });
  });

  it('asks with a personal access token as private-token', async () => {
    mockProjectShow(GITLAB_COM, { body: { id: 1 } });

    assert.equal(
      await gitLabProjectVisible(GITLAB_COM, PROJECT, {
        token: TOKEN,
        scheme: 'private-token',
      }),
      true
    );

    assertGitLabHeaders(requests[0], {
      token: TOKEN,
      scheme: 'private-token',
    });
  });

  it('answers false when the project is not there', async () => {
    mockProjectShow(GITLAB_COM, {
      status: 404,
      body: PROJECT_404,
      headers: JSON_CONTENT_TYPE,
    });

    assert.equal(await gitLabProjectVisible(GITLAB_COM, PROJECT, {}), false);
  });

  it('answers false when the instance itself fails', async () => {
    mockProjectShow(GITLAB_COM, {
      status: 502,
      body: jsonBody({ message: 'Bad gateway' }),
      headers: JSON_CONTENT_TYPE,
    });

    assert.equal(await gitLabProjectVisible(GITLAB_COM, PROJECT, {}), false);
  });

  it('answers false when the host cannot be reached', async () => {
    server.use(
      http.get(`https://${GITLAB_COM}/api/v4/projects/:project`, () =>
        HttpResponse.error()
      )
    );

    assert.equal(await gitLabProjectVisible(GITLAB_COM, PROJECT, {}), false);
  });

  it('lets the first visible host win, probing in order', async () => {
    // The route's loop, driven over two hosts: the miss is asked first and
    // recorded first, and the visible host ends the walk.
    mockProjectShow(GITLAB_CORP, {
      status: 404,
      body: PROJECT_404,
      headers: JSON_CONTENT_TYPE,
    });
    mockProjectShow(GITLAB_COM, { body: { id: 1 } });

    let winner: string | undefined;
    for (const host of [GITLAB_CORP, GITLAB_COM]) {
      if (await gitLabProjectVisible(host, PROJECT, {})) {
        winner = host;
        break;
      }
    }

    assert.equal(winner, GITLAB_COM);
    assert.deepEqual(
      requests.map((call) => call.host),
      [GITLAB_CORP, GITLAB_COM]
    );
  });
});
