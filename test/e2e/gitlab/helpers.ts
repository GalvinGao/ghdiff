import {
  ORIGIN,
  rpc as clientRpc,
  raw as clientRaw,
  type RawAnswer,
  type RawOptions,
  type RpcAnswer,
} from '@test/e2e/lib/client';
import { isIsoDate, MARKED, requireEnv } from '@test/e2e/lib/util';

// Shared machinery for the ghdiff e2e suite, GitLab flavor: the suite's ref,
// a client for the GitLab API the assertions cross-check against, and the
// fixture reset. The wire client lives in ../lib/client.ts, the small
// helpers in ../lib/util.ts — both re-exported here so a test file imports
// this module alone.
//
// Every artifact the suite creates carries a body starting with MARK, and the
// reset deletes by that prefix — the seeded fixture content and anything a
// human wrote are never matched.
import type { PullRef } from '@/lib/forges';

export { ORIGIN, isIsoDate };
export type {
  RpcAnswer,
  RawAnswer,
  ViewerGetAnswer,
} from '@test/e2e/lib/client';

// The instance and the fixture project are the runner's to name: the suite is
// written against any GitLab that holds the seeded fixture, and no host is
// baked in.
export const HOST = requireEnv('E2E_GITLAB_HOST');
export const PROJECT = requireEnv('E2E_GITLAB_PROJECT');
export const GL = `https://${HOST}/api/v4/projects/${encodeURIComponent(PROJECT)}`;
export const TOKEN = requireEnv('GITLAB_TOKEN');
export const MARK = `[e2e ${Date.now()}]`;
export const MRS = [1, 2, 3];

export const ref = (number: number): PullRef => ({
  forge: 'gitlab',
  host: HOST,
  project: PROJECT,
  number,
});

export interface GitLabViewer {
  username: string;
  [key: string]: unknown;
}

// Who the token belongs to, read once at import.
export const VIEWER: GitLabViewer = await fetch(`https://${HOST}/api/v4/user`, {
  headers: { 'private-token': TOKEN },
}).then((r) => r.json() as Promise<GitLabViewer>);

// --- ghdiff RPC and raw routes, pre-bound to the fixture token ---------------

export interface RpcOptions {
  /** 'none' sends no credential — the anonymous path. */
  auth?: 'bearer' | 'none';
  cookie?: string;
}

export const rpc = <T = unknown>(
  path: string,
  input: unknown,
  { auth = 'bearer', cookie }: RpcOptions = {}
): Promise<RpcAnswer<T>> =>
  clientRpc<T>(path, input, {
    token: auth === 'bearer' ? TOKEN : undefined,
    cookie,
  });

export const raw = (
  path: string,
  {
    bearer = true,
    ...rest
  }: Omit<RawOptions, 'token'> & { bearer?: boolean } = {}
): Promise<RawAnswer> =>
  clientRaw(path, { token: bearer ? TOKEN : undefined, ...rest });

// --- GitLab direct (assertion side) ------------------------------------------

export interface GlNote {
  id: number;
  body?: string;
  note?: string;
  system?: boolean;
  type?: string | null;
  position?: { new_line?: number } | null;
  resolved?: boolean;
}

export interface GlDiscussion {
  id: string;
  notes: GlNote[];
}

export interface GlDraftNote {
  id: number;
  note?: string;
}

export interface GlApprovals {
  approved_by?: { user?: { username?: string } }[];
}

export interface GlMergeRequest {
  description?: string;
  [key: string]: unknown;
}

export async function gl<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${GL}${path}`, {
    method,
    headers: { 'private-token': TOKEN, 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null as T;
  const text = await res.text();
  if (!res.ok)
    throw new Error(`GitLab ${method} ${path}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * Every page of a list endpoint, 100 entries at a time — GitLab's default is
 * 20. Read in full before any delete, so nothing shifts between pages under
 * the walk.
 */
export async function glAll<T>(path: string): Promise<T[]> {
  const all: T[] = [];
  const glue = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const batch = await gl<T[]>(
      'GET',
      `${path}${glue}per_page=100&page=${page}`
    );
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

export const discussions = (mr: number): Promise<GlDiscussion[]> =>
  glAll(`/merge_requests/${mr}/discussions`);

export const draftNotes = (mr: number): Promise<GlDraftNote[]> =>
  glAll(`/merge_requests/${mr}/draft_notes`);

const markedDraft = (d: GlDraftNote): boolean => MARKED.test(d.note ?? '');
const markedNote = (n: GlNote): boolean =>
  n.system !== true && MARKED.test(n.body ?? '');

// Deletes every marked draft and note on the fixture MRs and takes MR 2's
// approval back. Seeded content and human-written drafts carry no marker and
// are never touched.
export async function resetFixture(): Promise<void> {
  for (const mr of MRS) {
    for (const draft of await draftNotes(mr)) {
      if (markedDraft(draft)) {
        await gl('DELETE', `/merge_requests/${mr}/draft_notes/${draft.id}`);
      }
    }
    for (const disc of await discussions(mr)) {
      for (const note of disc.notes) {
        if (markedNote(note)) {
          await gl(
            'DELETE',
            `/merge_requests/${mr}/discussions/${disc.id}/notes/${note.id}`
          );
        }
      }
    }
  }
  const approvals = await gl<GlApprovals>('GET', '/merge_requests/2/approvals');
  if (approvals.approved_by != null && approvals.approved_by.length > 0) {
    await gl('POST', '/merge_requests/2/unapprove');
  }
}

// Deletes only artifacts carrying `mark` (this process's MARK by default) —
// a test file's afterAll hook.
export async function cleanupOwn(
  mrs: number[] = MRS,
  mark: string = MARK
): Promise<void> {
  for (const mr of mrs) {
    for (const draft of await draftNotes(mr)) {
      if ((draft.note ?? '').startsWith(mark)) {
        await gl('DELETE', `/merge_requests/${mr}/draft_notes/${draft.id}`);
      }
    }
    for (const disc of await discussions(mr)) {
      for (const note of disc.notes) {
        if ((note.body ?? '').startsWith(mark)) {
          await gl(
            'DELETE',
            `/merge_requests/${mr}/discussions/${disc.id}/notes/${note.id}`
          );
        }
      }
    }
  }
}
