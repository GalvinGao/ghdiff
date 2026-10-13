import { oc, type } from '@orpc/contract';
import * as z from 'zod';

import type { CreatedIssue } from '@/lib/commentIssue';
import type { CommentPayload } from '@/lib/comments';
import type { DeploymentsData } from '@/lib/deployments';
import type { AppInstallation } from '@/lib/installations';
import type { ConversationEntry } from '@/lib/pullConversation';
import type { PullDetails } from '@/lib/pullDetails';
import type { OpenPullsAnswer } from '@/lib/pulls';
import type { SubmittedReview, TeamReview } from '@/lib/reviewDecision';
import { HOST_PATTERN, reviewTargetSearch } from '@/lib/reviewTarget';
import type { ViewedFilesData } from '@/lib/viewedFiles';
import type { GitHubViewer } from '@/lib/viewer';
import { m } from '@/paraglide/messages.js';

// The whole API, stated once, in a module that imports nothing from a server
// and nothing from a component. The Worker implements this and the browser
// calls it, and neither one describes a request in its own words: a field
// renamed here fails to compile on both sides at once, which is the thing the
// hand-written `fetch` calls and their `as` casts could not do.
//
// Inputs carry a zod schema, because they arrive from a URL and cannot be
// trusted. Outputs carry `type<T>()`, which is a type and no runtime check:
// the payload shapes already have one home each in `src/lib`, and a second
// description of them in zod would be a copy free to drift.

/** GitHub's own rule for an owner or a repository name. */
const NAME = /^[A-Za-z0-9._-]+$/;

// Every message is a function the schema calls when it fails, so the sentence
// is the request's own locale and never the one the module loaded in.
const name = z.string().regex(NAME, {
  error: () => m.contract_enter_a_valid_owner_group_or_repository_name(),
});

/** A hostname, with an optional port: `gitlab.com`, `gitlab.corp.com:8443`. */
const host = z.string().regex(HOST_PATTERN, {
  error: () => m.contract_enter_a_valid_gitlab_hostname(),
});

/** A GitLab project's full path, namespaces included: `group/sub/repo`. */
const project = z.string().regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/, {
  error: () => m.contract_enter_a_valid_project_path(),
});

/** A comment's words, which a forge refuses to take empty. */
const commentBody = z
  .string()
  .trim()
  .min(1, { error: () => m.contract_comment_cannot_be_empty() });

/** The repository fields of each forge, shared by every ref shape below. */
const githubRepo = { forge: z.literal('github'), owner: name, repo: name };
const gitlabRepo = { forge: z.literal('gitlab'), host, project };

/** A repository on either forge. The `forge` field is the discriminant. */
const repoRef = z.discriminatedUnion('forge', [
  z.object(githubRepo),
  z.object(gitlabRepo),
]);

/** A pullRef with extra fields, kept as a union so `forge` still discriminates. */
const pullRefWith = <T extends Record<string, z.ZodType>>(extra: T) =>
  z.discriminatedUnion('forge', [
    z.object({ ...githubRepo, number: z.int().positive(), ...extra }),
    z.object({ ...gitlabRepo, number: z.int().positive(), ...extra }),
  ]);

const pullRef = pullRefWith({});

/** `additions` is GitHub's RIGHT and `deletions` is its LEFT. */
const side = z.enum(['additions', 'deletions']);

/**
 * One end of a GitLab diff position, as raw cursors on both sides of the
 * diff: `oldPos` and `newPos` are the line numbers the row carries in each
 * file — the one a single-coordinate note hides included — and `kind` says
 * whether the row is an addition, a deletion, or a context line.
 */
const gitLabCursor = z.object({
  oldPos: z.int().positive(),
  newPos: z.int().positive(),
  kind: z.enum(['addition', 'deletion', 'context']),
});

/**
 * A GitLab diff position the client that holds the parsed diff can state
 * exactly: the real `oldPath`/`newPath` of a renamed file included. GitLab
 * derives a note's anchor from these, so a comment on a renamed file or a
 * context line lands where it was written. Optional everywhere: a caller
 * that cannot supply the cursors keeps the scalar `path`/`line`/`side`
 * shape, and GitLab's answer to that is what it always was.
 */
const gitLabPosition = z.object({
  oldPath: z.string().min(1),
  newPath: z.string().min(1),
  end: gitLabCursor,
  start: gitLabCursor.optional(),
});

export const contract = {
  viewer: {
    /**
     * Who the request speaks as. A caller with no credential is not an error: it
     * answers with no viewer, and the screen offers a sign-in.
     *
     * `fromSession` is what separates a reviewer who signed in from a deployment
     * running on `GITHUB_TOKEN`. Both have a viewer and both post comments as
     * that account, and only the first has a sign-out to offer — so the menu
     * reads this rather than guessing from the viewer alone. It is true when any
     * credential resolved from the cookie, a GitLab connection's included.
     * `githubFromSession` is the GitHub grant's alone: what Disconnect GitHub
     * would end.
     */
    get: oc.output(
      type<{
        viewer?: GitHubViewer;
        fromSession?: boolean;
        githubFromSession?: boolean;
        /** The GitLab connections this session holds, one viewer per host. */
        gitlab?: { host: string; viewer: GitHubViewer }[];
      }>()
    ),
  },

  installations: {
    /**
     * Where this reviewer has ghdiff installed, and where to install it again.
     * The setup page is the only caller: signing in and being able to read a
     * diff are two different facts under a GitHub App, and this is the second
     * one.
     *
     * A caller with no credential is not an error. It answers with an empty list
     * and the install address, which is exactly what step one of that page is
     * about to say anyway.
     */
    list: oc.output(
      type<{ installations: AppInstallation[]; installUrl?: string }>()
    ),
  },

  pulls: {
    /** The open pull requests of the watched repositories, flat. */
    list: oc
      .input(z.object({ repos: z.array(repoRef) }))
      .output(type<OpenPullsAnswer>()),

    /** One pull request's own details, for the card behind its title. */
    get: oc.input(pullRef).output(type<PullDetails>()),
  },

  reviews: {
    /**
     * The verdict the caller has already left on this pull request, so the
     * header can say what it is rather than offer to take a first one. It
     * answers with no review for a caller who has never reviewed, and for one
     * with no token: the viewer is the token's own, so an anonymous caller has
     * no review to look up.
     */
    mine: oc.input(pullRef).output(type<{ review?: SubmittedReview }>()),

    /**
     * The newest verdicts other people left on this pull request, for the top
     * of the review dialog. The viewer's own is `mine`, and a caller with no
     * credential gets an empty list: the list is a courtesy beside the diff
     * rather than a part of it.
     */
    team: oc.input(pullRef).output(type<{ reviews: TeamReview[] }>()),

    /**
     * A verdict on the pull request as a whole. The three events are GitHub's
     * own spelling, and the body is optional here rather than conditional:
     * `canSubmitReview` holds the button until a verdict that needs words has
     * them, and GitHub is the authority on the rest. The staged comments are
     * the forge's own drafts by the time a verdict is sent, so the call
     * carries none — publishing them is the forge's half of the submit.
     */
    submit: oc
      .input(
        pullRefWith({
          event: z.enum(['APPROVE', 'COMMENT', 'REQUEST_CHANGES']),
          body: z.string().optional(),
        })
      )
      .output(type<SubmittedReview>()),
  },

  deployments: {
    /**
     * The deployments the forge has on record for the commits under review,
     * and the head they are measured against. A pull request answers for its
     * newest commits, so a build of an older push is still a link the menu can
     * offer; a commit and a compare range answer for their head.
     *
     * A repository the credential may not read deployments in answers with an
     * empty list, not an error: the header then draws no menu, which is what a
     * repository that deploys nothing draws too.
     */
    list: oc
      .input(z.object({ target: reviewTargetSearch }))
      .output(type<DeploymentsData>()),
  },

  issues: {
    /**
     * An issue in the repository under review, made from a note on some of its
     * lines. The Worker resolves the commit each side of the diff was read
     * from, because a permalink needs a full sha and the browser holds a pull
     * request number, a short sha or a branch name. `line`, `startLine` and
     * `side` are one side's range, the way `commentPayloadRangeFields` reduces
     * a selection for a review comment.
     */
    create: oc
      .input(
        z.object({
          target: reviewTargetSearch,
          text: z
            .string()
            .trim()
            .min(1, {
              error: () => m.contract_write_what_the_issue_is_about(),
            }),
          path: z.string().min(1),
          line: z.int().positive(),
          startLine: z.int().positive().optional(),
          side,
        })
      )
      .output(type<CreatedIssue>()),
  },

  stats: {
    /**
     * How many diffs this deployment has served, for the footer's own line. It
     * takes no input and no token: it is one number about the app itself, and
     * every reviewer sees the same one.
     */
    served: oc.output(type<{ count: number }>()),
  },

  viewedFiles: {
    /**
     * The files of this pull request the caller has already read. The mark is
     * the token's own, so a caller with no token gets an empty list rather
     * than an error, the way `reviews.mine` answers with no review.
     */
    list: oc.input(pullRef).output(type<ViewedFilesData>()),

    /**
     * Marks one file read, or takes the mark back. GitHub addresses the file
     * by its path on the new side, which is what `PullRequestChangedFile.path`
     * answers with and what this app's own item carries.
     */
    set: oc
      .input(
        pullRefWith({
          path: z.string().min(1),
          viewed: z.boolean(),
        })
      )
      .output(type<{ ok: true }>()),
  },

  comments: {
    list: oc.input(pullRef).output(type<CommentPayload[]>()),

    /**
     * What was said about the pull request as a whole: the comments under its
     * description and the reviews with a verdict or a summary, oldest first.
     * The line comments are `list`, and none of them is repeated here.
     */
    conversation: oc.input(pullRef).output(type<ConversationEntry[]>()),

    /**
     * A new comment, or a reply to one. A reply names only the comment it
     * answers: the path, the line, the side and the commit all come from that
     * comment, so a reply cannot drift off its thread.
     */
    create: oc
      .input(
        pullRefWith({
          body: commentBody,
          replyToId: z.int().positive().optional(),
          path: z.string().min(1).optional(),
          line: z.int().positive().optional(),
          side: side.optional(),
          startLine: z.int().positive().optional(),
          startSide: side.optional(),
          gitlabPosition: gitLabPosition.optional(),
        })
      )
      .output(type<CommentPayload>()),

    remove: oc
      .input(pullRefWith({ commentId: z.int().positive() }))
      .output(type<{ ok: true }>()),

    /**
     * Resolves a review thread on the forge, or takes the mark back. The
     * thread is named by the id its forge reported on the root payload —
     * GitHub's review-thread node id, GitLab's discussion id.
     */
    resolve: oc
      .input(
        pullRefWith({ threadId: z.string().min(1), resolved: z.boolean() })
      )
      .output(type<{ resolved: boolean }>()),
  },

  /**
   * The forge's own draft comments — GitHub's pending-review threads, GitLab's
   * draft notes. A draft is the token's own by definition, so every procedure
   * here wants a credential the way `comments.create` does. The drafts a
   * verdict publishes are exactly these; there is no local staging beside them.
   */
  drafts: {
    list: oc.input(pullRef).output(type<{ drafts: CommentPayload[] }>()),

    /**
     * A new draft on a diff line. Every range field is required where
     * `comments.create` leaves it optional — a draft is always a new thread
     * on a named line, so there is no `replyToId`.
     */
    create: oc
      .input(
        pullRefWith({
          path: z.string().min(1),
          line: z.int().positive(),
          side,
          startLine: z.int().positive().optional(),
          startSide: side.optional(),
          gitlabPosition: gitLabPosition.optional(),
          body: commentBody,
        })
      )
      .output(type<CommentPayload>()),

    /**
     * Takes one draft back. GitHub's mutation addresses a review comment by
     * its GraphQL node id and GitLab's by its numeric one, so the caller
     * sends whichever the forge reported — one of the two, at least.
     */
    remove: oc
      .input(
        pullRefWith({
          id: z.number().int().positive().optional(),
          nodeId: z.string().optional(),
        }).refine((input) => input.id != null || input.nodeId != null, {
          error: () => m.contract_a_draft_to_delete_needs_an_id(),
        })
      )
      .output(type<{ ok: true }>()),
  },
};
