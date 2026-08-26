import { oc, type } from '@orpc/contract';
import * as z from 'zod';

import type { CommentPayload } from '@/lib/comments';
import type { PullDetails } from '@/lib/pullDetails';
import type { OpenPullsData } from '@/lib/pulls';
import type { SubmittedReview } from '@/lib/reviewDecision';
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

const name = z
  .string()
  .regex(NAME, 'Enter a valid GitHub username or repository name.');

const repoRef = z.object({ owner: name, repo: name });

const pullRef = repoRef.extend({
  number: z.int().positive(),
});

/** `additions` is GitHub's RIGHT and `deletions` is its LEFT. */
const side = z.enum(['additions', 'deletions']);

export const contract = {
  viewer: {
    /**
     * Who the token belongs to. A caller with no token is not an error: it
     * answers with no viewer, and the form asks for one.
     */
    get: oc.output(type<{ viewer?: GitHubViewer }>()),
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

  comments: {
    list: oc.input(pullRef).output(type<CommentPayload[]>()),

    /**
     * A new comment, or a reply to one. A reply names only the comment it
     * answers: the path, the line, the side and the commit all come from that
     * comment, so a reply cannot drift off its thread.
     */
    create: oc
      .input(
        pullRef.extend({
          body: z.string().trim().min(1, 'Comment cannot be empty.'),
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
