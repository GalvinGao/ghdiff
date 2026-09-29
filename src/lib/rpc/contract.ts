import { oc, type } from '@orpc/contract';
import * as z from 'zod';

import { m } from '../../paraglide/messages.js';
import type { CreatedIssue } from '@/lib/commentIssue';
import type { CommentPayload } from '@/lib/comments';
import type { AppInstallation } from '@/lib/installations';
import type { ConversationEntry } from '@/lib/pullConversation';
import type { PullDetails } from '@/lib/pullDetails';
import type { OpenPullsData } from '@/lib/pulls';
import type { SubmittedReview, TeamReview } from '@/lib/reviewDecision';
import type { ViewedFilesData } from '@/lib/viewedFiles';
import type { GitHubViewer } from '@/lib/viewer';

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

const name = z.string().regex(NAME, {
  error: () => m.contract_enter_a_valid_github_username_or_repository_name(),
});

const repoRef = z.object({ owner: name, repo: name });

const pullRef = repoRef.extend({
  number: z.int().positive(),
});

/** `additions` is GitHub's RIGHT and `deletions` is its LEFT. */
const side = z.enum(['additions', 'deletions']);

/**
 * The diff a note was written on, as the three GitHub targets name it. Each is
 * the part of `GitHubReviewTarget` that is not the repository.
 */
const issueSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('github-pull'), number: z.int().positive() }),
  z.object({
    kind: z.literal('github-commit'),
    sha: z.string().regex(/^[0-9a-f]{7,40}$/i, {
      error: () => m.contract_enter_a_commit_sha(),
    }),
  }),
  z.object({
    kind: z.literal('github-compare'),
    base: z.string().min(1),
    head: z.string().min(1),
  }),
]);

export const contract = {
  viewer: {
    /**
     * Who the request speaks as. A caller with no credential is not an error: it
     * answers with no viewer, and the screen offers a sign-in.
     *
     * `fromSession` is what separates a reviewer who signed in from a deployment
     * running on `GITHUB_TOKEN`. Both have a viewer and both post comments as
     * that account, and only the first has a sign-out to offer — so the menu
     * reads this rather than guessing from the viewer alone.
     */
    get: oc.output(type<{ viewer?: GitHubViewer; fromSession?: boolean }>()),
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
      .output(type<OpenPullsData>()),

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
     * token gets an empty list: GraphQL refuses an anonymous caller, and the
     * list is a courtesy beside the diff rather than a part of it.
     */
    team: oc.input(pullRef).output(type<{ reviews: TeamReview[] }>()),

    /**
     * A verdict on the pull request as a whole. The three events are GitHub's
     * own spelling, and the body is optional here rather than conditional:
     * `canSubmitReview` holds the button until a verdict that needs words has
     * them, and GitHub is the authority on the rest.
     */
    submit: oc
      .input(
        pullRef.extend({
          event: z.enum(['APPROVE', 'COMMENT', 'REQUEST_CHANGES']),
          body: z.string().optional(),
        })
      )
      .output(type<SubmittedReview>()),
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
        pullRef.extend({
          path: z.string().min(1),
          viewed: z.boolean(),
        })
      )
      .output(type<{ ok: true }>()),
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
        repoRef.extend({
          source: issueSource,
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
        pullRef.extend({
          body: z
            .string()
            .trim()
            .min(1, { error: () => m.contract_comment_cannot_be_empty() }),
          replyToId: z.int().positive().optional(),
          path: z.string().min(1).optional(),
          line: z.int().positive().optional(),
          side: side.optional(),
          startLine: z.int().positive().optional(),
          startSide: side.optional(),
        })
      )
      .output(type<CommentPayload>()),

    remove: oc
      .input(repoRef.extend({ commentId: z.int().positive() }))
      .output(type<{ ok: true }>()),
  },
};
