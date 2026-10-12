import { graphql } from './gqlgen/github';

// `reviewThreads` is the comments read: each node is one thread, with its
// resolution state, its position on the diff, and its comments root first.
// REST's flat comment list carries no resolution state, which is why the read
// is here and not there. The two mutations under it take the state back and
// forth, addressed by the thread's node id — which the read reports as the
// root payload's `threadId`, and `comments.resolve` sends back.
//
// The two fragments are the thread and comment selection the read and the
// add-thread mutation share, so a thread maps to a payload the same way
// however it arrived. They stand alone because the codegen resolves a spread
// by name across the file's documents. The comment's review `state` is the
// partition key between the two reads: a `PENDING` review's threads are the
// drafts, and the published list excludes them.
graphql(`
  fragment ReviewThreadFields on PullRequestReviewThread {
    id
    isResolved
    path
    line
    originalLine
    startLine
    originalStartLine
    diffSide
    startDiffSide
  }
`);

graphql(`
  fragment ReviewCommentFields on PullRequestReviewComment {
    databaseId
    id
    author {
      __typename
      login
      avatarUrl
    }
    body
    bodyHTML
    createdAt
    url
    pullRequestReview {
      databaseId
      state
    }
  }
`);

export const REVIEW_THREADS_QUERY = graphql(`
  query ReviewThreads(
    $owner: String!
    $repo: String!
    $number: Int!
    $first: Int!
    $after: String
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ...ReviewThreadFields
            comments(first: 100) {
              nodes {
                ...ReviewCommentFields
              }
            }
          }
        }
      }
    }
  }
`);

export const RESOLVE_REVIEW_THREAD_MUTATION = graphql(`
  mutation ResolveReviewThread($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      clientMutationId
    }
  }
`);

export const UNRESOLVE_REVIEW_THREAD_MUTATION = graphql(`
  mutation UnresolveReviewThread($threadId: ID!) {
    unresolveReviewThread(input: { threadId: $threadId }) {
      clientMutationId
    }
  }
`);

// `reviews(last: 1, states: [CHANGES_REQUESTED])` is the one review that
// matters here: the newest request for changes, so the author's newest commit
// can be compared against it.
//
// `latestOpinionatedReviews` is the review axis itself, and `reviewFromSource`
// says why `reviewDecision` cannot carry it alone. Twenty is the page, because
// a pull request with more than twenty people who each left a verdict is a
// pull request nobody is reading a list of squares for — past that the axis
// misses a twenty-first reviewer's request for changes. `first` is the whole
// page's own cap, so the nesting costs about twenty rate-limit points per
// repository, against the five thousand an hour a token has. The list is
// fetched once a session.
//
// `viewer { login }` rides along because the list is where the rail learns who
// the token belongs to: one query per repository, and the first answer names
// the viewer for the group.
export const OPEN_PULLS_QUERY = graphql(`
  query OpenPulls($owner: String!, $repo: String!, $first: Int!) {
    viewer {
      login
    }
    repository(owner: $owner, name: $repo) {
      pullRequests(
        states: OPEN
        first: $first
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        nodes {
          number
          title
          url
          isDraft
          updatedAt
          headRefName
          baseRefName
          headRefOid
          reviewDecision
          author {
            login
            avatarUrl
          }
          commits(last: 1) {
            nodes {
              commit {
                oid
                committedDate
                statusCheckRollup {
                  state
                }
              }
            }
          }
          reviews(last: 1, states: [CHANGES_REQUESTED]) {
            nodes {
              submittedAt
            }
          }
          latestOpinionatedReviews(first: 20) {
            nodes {
              state
            }
          }
          reviewRequests(first: 20) {
            nodes {
              requestedReviewer {
                ... on User {
                  login
                }
              }
            }
          }
        }
      }
    }
  }
`);

// `viewerLatestReview` is the whole question in one field: the last review this
// token's own user left on this pull request. REST has no equivalent — it
// answers with every review by everybody, over as many pages as the pull
// request has collected, and the caller would then have to ask GitHub who it is
// before it could pick out its own.
export const MY_REVIEW_QUERY = graphql(`
  query MyReview($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        viewerLatestReview {
          databaseId
          state
          submittedAt
          url
        }
      }
    }
  }
`);

// `viewerViewedState` is the whole question in one field: what this token's own
// user has said about this file. REST has no equivalent — the pull request
// files endpoint answers with the patch and the counts and says nothing about
// who has read what — so this and the two mutations under it are GraphQL only.
export const VIEWED_FILES_QUERY = graphql(`
  query ViewedFiles(
    $owner: String!
    $repo: String!
    $number: Int!
    $first: Int!
    $after: String
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        files(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            path
            viewerViewedState
          }
        }
      }
    }
  }
`);

export const PULL_NODE_ID_QUERY = graphql(`
  query PullNodeId($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        id
      }
    }
  }
`);

// The check axis of one pull request's head commit — the half of
// `OPEN_PULLS_QUERY`'s node that `checkStateFromSource` reads. GraphQL only
// because REST carries no rollup: the combined-status endpoint knows commit
// statuses and not check runs, which is what GitHub Actions reports.
export const PULL_CHECK_QUERY = graphql(`
  query PullCheck($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        headRefOid
        commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                state
              }
            }
          }
        }
      }
    }
  }
`);

export const MARK_FILE_VIEWED_MUTATION = graphql(`
  mutation MarkFileViewed($pullRequestId: ID!, $path: String!) {
    markFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {
      clientMutationId
    }
  }
`);

export const UNMARK_FILE_VIEWED_MUTATION = graphql(`
  mutation UnmarkFileViewed($pullRequestId: ID!, $path: String!) {
    unmarkFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {
      clientMutationId
    }
  }
`);

// A staged comment is github.com's own "pending review" under another name:
// one review per viewer per pull request that sits PENDING, holds its line
// comments, and takes the verdict when it is submitted. `reviews(first,
// author: $viewer)` finds it — GraphQL has no `viewerPendingReview`, so the
// viewer's login is read first, the way github-mcp-server does it. The
// mutations then do the work: `addPullRequestReview` with no event opens the
// review, `addPullRequestReviewThread` puts a line comment on it,
// `deletePullRequestReviewComment` takes one back, and the REST events
// endpoint submits it.
export const VIEWER_LOGIN_QUERY = graphql(`
  query ViewerLogin {
    viewer {
      login
    }
  }
`);

export const PENDING_REVIEW_QUERY = graphql(`
  query PendingReview(
    $owner: String!
    $repo: String!
    $number: Int!
    $viewer: String!
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviews(first: 1, author: $viewer, states: [PENDING]) {
          nodes {
            id
            databaseId
            state
          }
        }
      }
    }
  }
`);

export const ADD_REVIEW_MUTATION = graphql(`
  mutation AddReview($pullRequestId: ID!) {
    addPullRequestReview(input: { pullRequestId: $pullRequestId }) {
      pullRequestReview {
        id
        databaseId
      }
    }
  }
`);

// The thread's position lives on the thread, never on its comments — the
// review-comment type has no `side` to select. The return selection is the
// reviewThreads read's own, minus what a fresh thread cannot have.
export const ADD_REVIEW_THREAD_MUTATION = graphql(`
  mutation AddReviewThread($input: AddPullRequestReviewThreadInput!) {
    addPullRequestReviewThread(input: $input) {
      thread {
        ...ReviewThreadFields
        comments(first: 1) {
          nodes {
            ...ReviewCommentFields
          }
        }
      }
    }
  }
`);

export const DELETE_REVIEW_COMMENT_MUTATION = graphql(`
  mutation DeleteReviewComment($id: ID!) {
    deletePullRequestReviewComment(input: { id: $id }) {
      clientMutationId
    }
  }
`);

// The newest reviews on the pull request, whoever wrote them, for the top of
// the review dialog. `recentTeamReviews` drops the viewer's own, the bots', and
// the bare replies GitHub files as reviews, so the page is wider than the five
// the dialog lists: on a pull request with a busy line thread, most of the last
// fifty are those replies. `viewerDidAuthor` is what tells the viewer's own
// apart without asking GitHub who the viewer is.
export const TEAM_REVIEWS_QUERY = graphql(`
  query TeamReviews(
    $owner: String!
    $repo: String!
    $number: Int!
    $last: Int!
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviews(last: $last) {
          nodes {
            databaseId
            state
            submittedAt
            url
            bodyText
            viewerDidAuthor
            author {
              kind: __typename
              login
              avatarUrl
            }
            comments {
              totalCount
            }
          }
        }
      }
    }
  }
`);

// A commit by any name — a sha of any length or a branch — as its full sha and
// its first parent, which is what a permalink to one side of a diff needs. One
// request that carries no file list, where REST's commit endpoint would attach
// up to 300 patches to the same answer.
export const COMMIT_OID_QUERY = graphql(`
  query CommitOid($owner: String!, $repo: String!, $rev: String!) {
    repository(owner: $owner, name: $repo) {
      object(expression: $rev) {
        ... on Commit {
          oid
          parents(first: 1) {
            nodes {
              oid
            }
          }
        }
      }
    }
  }
`);

// What the deployments menu reads off one commit: its own check rollup and the
// newest deployments made from it, each with the status that says where it
// went. `$deployments` is per commit — a commit is built once per environment,
// so ten is room for ten environments or the rebuilds of a few.
graphql(`
  fragment DeployedCommit on Commit {
    oid
    statusCheckRollup {
      state
    }
    deployments(
      first: $deployments
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      nodes {
        databaseId
        environment
        description
        createdAt
        state
        creator {
          login
          avatarUrl
        }
        ref {
          name
        }
        latestStatus {
          state
          environmentUrl
          logUrl
        }
      }
    }
  }
`);

export const DEPLOYMENTS_OF_PULL_QUERY = graphql(`
  query DeploymentsOfPull(
    $owner: String!
    $repo: String!
    $number: Int!
    $commits: Int!
    $deployments: Int!
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        headRefName
        headRefOid
        commits(last: $commits) {
          nodes {
            commit {
              ...DeployedCommit
            }
          }
        }
      }
    }
  }
`);

export const DEPLOYMENTS_OF_COMMIT_QUERY = graphql(`
  query DeploymentsOfCommit(
    $owner: String!
    $repo: String!
    $expression: String!
    $deployments: Int!
  ) {
    repository(owner: $owner, name: $repo) {
      object(expression: $expression) {
        ...DeployedCommit
      }
    }
  }
`);
