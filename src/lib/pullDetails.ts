// One pull request's own facts, for the card behind its title in the header.
//
// The switcher's `PullSummary` is what a list row needs. This is what the card
// needs: the description, the counts, and the two dates. It is a separate shape
// because it costs a separate request, and only the pull request on screen pays
// for it.

import { type PullState, pullState } from './pulls.ts';

export interface PullDetails {
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: PullState;
  author: string;
  authorAvatarUrl?: string;
  htmlUrl: string;
  headRef: string;
  baseRef: string;
  createdAt: string;
  updatedAt: string;
  /** The description, as GitHub markdown. Absent when the author left it empty. */
  body?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  commits?: number;
}

/** The fields this module reads from GitHub's pull request payload. */
export interface PullDetailsInput {
  number: number;
  title: string;
  draft?: boolean;
  state?: string;
  merged_at?: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  body?: string | null;
  user: { login: string; avatar_url?: string } | null;
  head: { ref: string };
  base: { ref: string };
  additions?: number;
  deletions?: number;
  changed_files?: number;
  commits?: number;
}

export function toPullDetails(
  owner: string,
  repo: string,
  pull: PullDetailsInput
): PullDetails {
  const body = pull.body?.trim();
  return {
    owner,
    repo,
    number: pull.number,
    title: pull.title,
    state: pullState(pull),
    author: pull.user?.login ?? 'unknown',
    authorAvatarUrl: pull.user?.avatar_url,
    htmlUrl: pull.html_url,
    headRef: pull.head.ref,
    baseRef: pull.base.ref,
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    body: body != null && body.length > 0 ? body : undefined,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changed_files,
    commits: pull.commits,
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * How long ago something happened, in the one unit that reads fastest. A review
 * cares whether a pull request moved an hour ago or last month, never that it
 * moved 37 days and 4 hours ago.
 */
export function describeAge(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const elapsed = now - then;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < WEEK) return plural(Math.floor(elapsed / DAY), 'day');
  if (elapsed < MONTH) return plural(Math.floor(elapsed / WEEK), 'week');
  if (elapsed < YEAR) return plural(Math.floor(elapsed / MONTH), 'month');
  return plural(Math.floor(elapsed / YEAR), 'year');
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}
