// What the rest of a merge request's reviewers decided, for the top of the
// review dialog, and the verdicts in its history, for the conversation above
// the comment list.
//
// GitLab keeps no review object the way GitHub does. A reviewer's decision is
// their reviewer state — reviewed, requested changes, approved — and an
// approval can come from somebody who was never asked to review. So the team's
// list is the two read together, the reviewers first, and an approval stands
// for itself where its author has no reviewer state to say more. The
// conversation's verdicts are the system notes GitLab writes when one is
// given, since those carry the moment it happened.

import { isGitLabBotLogin } from '@/lib/commentAuthors';
import type { ConversationEntry } from '@/lib/pullConversation';
import { MAX_TEAM_REVIEWS, type TeamReview } from '@/lib/reviewDecision';
import type { ForgeCredential } from '@/lib/server/forges/types';
import { gitLabJson } from '@/lib/server/gitlab/api';

interface GitLabUser {
  id: number;
  username: string;
  avatar_url?: string | null;
  bot?: boolean;
}

/** `GET …/merge_requests/:iid/reviewers`, one row per reviewer asked. */
interface ReviewerSource {
  user: GitLabUser;
  state?: string | null;
}

/** `GET …/merge_requests/:iid/approvals`, as much of it as this reads. */
interface ApprovalsSource {
  approved_by?: { user: GitLabUser }[] | null;
}

/** `GET …/merge_requests/:iid/notes`, the system notes among them. */
interface NoteSource {
  id: number;
  body: string;
  system: boolean;
  created_at?: string | null;
  author?: GitLabUser | null;
}

/** A reviewer state as the verdict vocabulary the dialog already speaks. */
const STATE_OF_REVIEWER: Record<string, string> = {
  approved: 'APPROVED',
  requested_changes: 'CHANGES_REQUESTED',
  reviewed: 'COMMENTED',
};

/**
 * The verdicts GitLab writes into a merge request's history, by the system
 * note it writes for each. These bodies are GitLab's own and are not
 * translated by the instance, which is what makes them a reading at all.
 */
const STATE_OF_NOTE: Record<string, string> = {
  'approved this merge request': 'APPROVED',
  'requested changes': 'CHANGES_REQUESTED',
};

function isBot(user: GitLabUser): boolean {
  return user.bot === true || isGitLabBotLogin(user.username);
}

function mergeRequestPath(project: string, number: number): string {
  return `/projects/${encodeURIComponent(project)}/merge_requests/${number}`;
}

/**
 * The decisions other people made on the merge request: every reviewer with
 * a decision, then every approver who was not asked. The viewer's own and
 * the bots' are left out, the way GitHub's list leaves them. Neither list
 * says when a verdict was given — a reviewer row dates the request — so the
 * rows carry no age, in the order GitLab gives them.
 */
export async function readTeamReviews(
  host: string,
  project: string,
  number: number,
  cred: ForgeCredential,
  webUrl: string
): Promise<TeamReview[]> {
  const path = mergeRequestPath(project, number);
  const [viewer, reviewers, approvals] = await Promise.all([
    gitLabJson<GitLabUser>(host, '/user', cred),
    gitLabJson<ReviewerSource[]>(host, `${path}/reviewers`, cred).catch(
      // Older instances have no reviewer states; the approvals still answer.
      (): ReviewerSource[] => []
    ),
    gitLabJson<ApprovalsSource>(host, `${path}/approvals`, cred),
  ]);
  const own = viewer.username.toLowerCase();
  const reviews: TeamReview[] = [];
  const seen = new Set<string>();
  for (const reviewer of reviewers) {
    const state = STATE_OF_REVIEWER[reviewer.state ?? ''];
    const login = reviewer.user.username.toLowerCase();
    if (state == null || login === own || isBot(reviewer.user)) continue;
    seen.add(login);
    reviews.push({
      id: reviewer.user.id,
      author: reviewer.user.username,
      authorAvatarUrl: reviewer.user.avatar_url ?? undefined,
      state,
      body: '',
      commentCount: 0,
      // No `submittedAt`: the reviewer row's `created_at` is when the review
      // was asked for, and a verdict's age read off it would be wrong by
      // however long the reviewer took.
      htmlUrl: webUrl,
    });
  }
  for (const { user } of approvals.approved_by ?? []) {
    const login = user.username.toLowerCase();
    if (login === own || seen.has(login) || isBot(user)) continue;
    seen.add(login);
    reviews.push({
      id: user.id,
      author: user.username,
      authorAvatarUrl: user.avatar_url ?? undefined,
      state: 'APPROVED',
      body: '',
      commentCount: 0,
      htmlUrl: webUrl,
    });
  }
  return reviews.slice(0, MAX_TEAM_REVIEWS);
}

/**
 * The verdicts in the merge request's history, oldest first. The remarks
 * under the description are not here: the comments read already lists them,
 * as the threads on the merge request itself, and the conversation repeats
 * none of the line threads' own.
 */
export async function readConversation(
  host: string,
  project: string,
  number: number,
  cred: ForgeCredential,
  webUrl: string
): Promise<ConversationEntry[]> {
  // The newest page, newest first: a busy merge request's history runs past
  // one page, and a verdict that matters is the latest one, not the first.
  const newest = await gitLabJson<NoteSource[]>(
    host,
    `${mergeRequestPath(project, number)}/notes?sort=desc&order_by=created_at&per_page=100`,
    cred
  );
  const notes = [...newest].reverse();
  const entries: ConversationEntry[] = [];
  for (const note of notes) {
    const state = note.system ? STATE_OF_NOTE[note.body.trim()] : undefined;
    if (state == null || note.author == null) continue;
    entries.push({
      key: `review-${note.id}`,
      kind: 'review',
      state,
      author: note.author.username,
      authorAvatarUrl: note.author.avatar_url ?? undefined,
      authorIsBot: isBot(note.author),
      body: '',
      createdAt: note.created_at ?? undefined,
      htmlUrl: `${webUrl}#note_${note.id}`,
    });
  }
  return entries;
}
