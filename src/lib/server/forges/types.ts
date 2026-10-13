import type { AnnotationSide } from '@pierre/diffs';

import type { CreatedIssue } from '@/lib/commentIssue';
import type { CommentPayload } from '@/lib/comments';
import type { DeploymentsData } from '@/lib/deployments';
import type { PullRef, RepoRef } from '@/lib/forges';
import type { RequestLog } from '@/lib/logger';
import type { ConversationEntry } from '@/lib/pullConversation';
import type { PullDetails } from '@/lib/pullDetails';
import type { OpenPullsData } from '@/lib/pulls';
import type {
  ReviewEvent,
  SubmittedReview,
  TeamReview,
} from '@/lib/reviewDecision';
import type { ForgeTarget, ReviewTarget } from '@/lib/reviewTarget';
import type { ViewedFilesData } from '@/lib/viewedFiles';
import type { GitHubViewer } from '@/lib/viewer';

/**
 * What a forge can do for ghdiff, sized by what the RPC router and the three
 * plain routes actually call. The GitHub implementation speaks REST and
 * GraphQL through octokit; the GitLab one speaks REST through gitbeaker. The
 * two plain-text hot paths — a streamed diff and a streamed whole file — are
 * hand-rolled `fetch` in both, because no SDK covers a 43 MB patch.
 */
export interface Forge {
  readonly capabilities: ForgeCapabilities;

  /**
   * One unified diff as text/plain, streamed. `ifNoneMatch` is the ETag of the
   * copy the browser kept: a source that compares it answers 304 and no body,
   * which goes back out as it is. A source that states no ETag is never asked.
   */
  diff(
    target: ReviewTarget,
    cred: ForgeCredential,
    log: RequestLog,
    ifNoneMatch?: string
  ): Promise<Response>;

  /**
   * One whole file as text/plain, at the ref the target's new side is on —
   * conditional the same way `diff` is.
   */
  file(
    target: ReviewTarget,
    path: string,
    cred: ForgeCredential,
    ifNoneMatch?: string
  ): Promise<Response>;

  /**
   * One image the forge hosts, streamed, with the caller's credential. A
   * private instance answers a browser's bare `<img>` only with its own
   * session cookie, which the reviewer does not have — the sealed grant lives
   * here — so `/api/media` proxies it. Absent on a forge whose images are
   * public already; the route answers the absence, the way the router does
   * for `viewedFiles`.
   */
  media?(
    target: ReviewTarget,
    url: string,
    cred: ForgeCredential
  ): Promise<Response>;

  /**
   * Who the credential belongs to. Undefined when it belongs to nobody. The
   * host names the instance for a forge that has more than one — GitLab —
   * and is unused on GitHub.
   */
  viewer(
    cred: ForgeCredential,
    host?: string
  ): Promise<GitHubViewer | undefined>;

  /** The open merge requests or pull requests of the given repositories. */
  listOpenPulls(
    repos: RepoRef[],
    cred: ForgeCredential
  ): Promise<OpenPullsData>;

  /** One pull request or merge request's own details. */
  pullDetails(ref: PullRef, cred: ForgeCredential): Promise<PullDetails>;

  comments: {
    list(ref: PullRef, cred: ForgeCredential): Promise<CommentPayload[]>;
    create(
      ref: PullRef,
      input: CreateCommentInput,
      cred: ForgeCredential
    ): Promise<CommentPayload>;
    remove(
      ref: PullRef,
      commentId: number,
      cred: ForgeCredential
    ): Promise<void>;
    /**
     * Resolves a review thread, or takes the mark back. Absent on a forge
     * whose threads carry no such state; the router answers the absence, the
     * way it does for `viewedFiles`.
     */
    resolve?(
      ref: PullRef,
      input: { threadId: string; resolved: boolean },
      cred: ForgeCredential
    ): Promise<void>;
    /**
     * What was said about the pull request as a whole — the remarks under its
     * description and the verdicts with words — oldest first. The line
     * comments are `list`, and none is repeated here.
     */
    conversation?(
      ref: PullRef,
      cred: ForgeCredential
    ): Promise<ConversationEntry[]>;
  };

  reviews: {
    /** The verdict the credential's own user already left, when there is one. */
    mine(
      ref: PullRef,
      cred: ForgeCredential
    ): Promise<SubmittedReview | undefined>;
    submit(
      ref: PullRef,
      input: {
        event: ReviewEvent;
        body?: string;
      },
      cred: ForgeCredential
    ): Promise<SubmittedReview>;
    /**
     * The newest verdicts other people left, the viewer's own and the bots'
     * left out. A credential is the forge's to require; with none the router
     * answers an empty list rather than asking.
     */
    team?(ref: PullRef, cred: ForgeCredential): Promise<TeamReview[]>;
  };

  /**
   * An issue in the repository under review, made from a note on some of its
   * lines, with a permalink to them at the commit each side was read from.
   * Absent on a forge that files none; the router answers the absence.
   */
  issues?: {
    create(
      target: ForgeTarget,
      input: CreateIssueInput,
      cred: ForgeCredential
    ): Promise<CreatedIssue>;
  };

  /**
   * The deployments the forge has on record for the commits under review,
   * and the head they are measured against. `outcome` is for the request log.
   * A repository the credential may not read deployments in answers an empty
   * list, not an error. Absent on a forge that keeps no deployments.
   */
  deployments?(
    target: ForgeTarget,
    cred: ForgeCredential
  ): Promise<DeploymentsData & { outcome: string }>;

  /**
   * The forge's own draft comments — GitHub's pending-review threads, GitLab's
   * draft notes — which the verdict publishes. Absent on a forge that keeps no
   * such thing; the router answers the absence, the way it does for
   * `viewedFiles`.
   */
  drafts?: {
    list(ref: PullRef, cred: ForgeCredential): Promise<CommentPayload[]>;
    create(
      ref: PullRef,
      input: CreateCommentInput,
      cred: ForgeCredential
    ): Promise<CommentPayload>;
    remove(
      ref: PullRef,
      input: { id?: number; nodeId?: string },
      cred: ForgeCredential
    ): Promise<void>;
  };

  /** Absent on a forge that keeps no such mark; the client then stays local. */
  viewedFiles?: {
    list(ref: PullRef, cred: ForgeCredential): Promise<ViewedFilesData>;
    set(
      ref: PullRef,
      input: { path: string; viewed: boolean },
      cred: ForgeCredential
    ): Promise<void>;
  };
}

/** A note filed as an issue: its words, and one side's range of lines. */
export interface CreateIssueInput {
  text: string;
  path: string;
  line: number;
  startLine?: number;
  side: AnnotationSide;
}

export interface ForgeCapabilities {
  /** The verdicts `ReviewSubmitDialog` may offer, in the contract's spelling. */
  verdicts: ReviewEvent[];
}

/**
 * The credential one request resolved for one forge. Anonymous is a first-
 * class answer: public diffs and public lists work without a token.
 */
export interface ForgeCredential {
  token?: string;
  /** True when the token came out of the sealed session cookie. */
  fromSession?: boolean;
  /**
   * How the token travels. GitHub only ever sends a bearer; GitLab sends a
   * bearer for OAuth and `PRIVATE-TOKEN` for a personal access token.
   */
  scheme?: 'bearer' | 'private-token';
}

export interface CreateCommentInput {
  body: string;
  replyToId?: number;
  path?: string;
  line?: number;
  side?: 'additions' | 'deletions';
  startLine?: number;
  startSide?: 'additions' | 'deletions';
  /**
   * A GitLab diff position stated as raw cursors on both sides of the diff,
   * for a caller that holds the parsed diff. The scalar `path`/`line`/`side`
   * fields travel as they always did; this is what lets the GitLab forge
   * place a comment on a renamed file or a context line, and build the
   * `line_code` a multiline range's ends require. Mirrored as zod in
   * `src/lib/rpc/contract.ts`; the GitHub forge never reads it.
   */
  gitlabPosition?: GitLabPositionInput;
}

/**
 * One end of a GitLab diff position. Both cursors are raw diff row numbers —
 * the one a single-coordinate note hides included — and `kind` says whether
 * the row is an addition, a deletion, or a context line.
 */
export interface GitLabPositionCursor {
  oldPos: number;
  newPos: number;
  kind: 'addition' | 'deletion' | 'context';
}

/**
 * A GitLab diff position as the client that holds the parsed diff states it:
 * the real `oldPath`/`newPath` of a renamed file included, the `end` cursor
 * required, the `start` cursor present only for a multiline comment.
 */
export interface GitLabPositionInput {
  oldPath: string;
  newPath: string;
  end: GitLabPositionCursor;
  start?: GitLabPositionCursor;
}
