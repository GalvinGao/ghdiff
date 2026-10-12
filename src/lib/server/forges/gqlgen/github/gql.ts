/* eslint-disable */
import * as types from './graphql';



/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  fragment ReviewThreadFields on PullRequestReviewThread {\n    id\n    isResolved\n    path\n    line\n    originalLine\n    startLine\n    originalStartLine\n    diffSide\n    startDiffSide\n  }\n": typeof types.ReviewThreadFieldsFragmentDoc,
    "\n  fragment ReviewCommentFields on PullRequestReviewComment {\n    databaseId\n    id\n    author {\n      __typename\n      login\n      avatarUrl\n    }\n    body\n    bodyHTML\n    createdAt\n    url\n    pullRequestReview {\n      databaseId\n      state\n    }\n  }\n": typeof types.ReviewCommentFieldsFragmentDoc,
    "\n  query ReviewThreads(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $first: Int!\n    $after: String\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        reviewThreads(first: $first, after: $after) {\n          pageInfo {\n            hasNextPage\n            endCursor\n          }\n          nodes {\n            ...ReviewThreadFields\n            comments(first: 100) {\n              nodes {\n                ...ReviewCommentFields\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n": typeof types.ReviewThreadsDocument,
    "\n  mutation ResolveReviewThread($threadId: ID!) {\n    resolveReviewThread(input: { threadId: $threadId }) {\n      clientMutationId\n    }\n  }\n": typeof types.ResolveReviewThreadDocument,
    "\n  mutation UnresolveReviewThread($threadId: ID!) {\n    unresolveReviewThread(input: { threadId: $threadId }) {\n      clientMutationId\n    }\n  }\n": typeof types.UnresolveReviewThreadDocument,
    "\n  query OpenPulls($owner: String!, $repo: String!, $first: Int!) {\n    viewer {\n      login\n    }\n    repository(owner: $owner, name: $repo) {\n      pullRequests(\n        states: OPEN\n        first: $first\n        orderBy: { field: UPDATED_AT, direction: DESC }\n      ) {\n        nodes {\n          number\n          title\n          url\n          isDraft\n          updatedAt\n          headRefName\n          baseRefName\n          headRefOid\n          reviewDecision\n          author {\n            login\n            avatarUrl\n          }\n          commits(last: 1) {\n            nodes {\n              commit {\n                oid\n                committedDate\n                statusCheckRollup {\n                  state\n                }\n              }\n            }\n          }\n          reviews(last: 1, states: [CHANGES_REQUESTED]) {\n            nodes {\n              submittedAt\n            }\n          }\n          latestOpinionatedReviews(first: 20) {\n            nodes {\n              state\n            }\n          }\n          reviewRequests(first: 20) {\n            nodes {\n              requestedReviewer {\n                ... on User {\n                  login\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n": typeof types.OpenPullsDocument,
    "\n  query MyReview($owner: String!, $repo: String!, $number: Int!) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        viewerLatestReview {\n          databaseId\n          state\n          submittedAt\n          url\n        }\n      }\n    }\n  }\n": typeof types.MyReviewDocument,
    "\n  query ViewedFiles(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $first: Int!\n    $after: String\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        files(first: $first, after: $after) {\n          pageInfo {\n            hasNextPage\n            endCursor\n          }\n          nodes {\n            path\n            viewerViewedState\n          }\n        }\n      }\n    }\n  }\n": typeof types.ViewedFilesDocument,
    "\n  query PullNodeId($owner: String!, $repo: String!, $number: Int!) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        id\n      }\n    }\n  }\n": typeof types.PullNodeIdDocument,
    "\n  query PullCheck($owner: String!, $repo: String!, $number: Int!) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        headRefOid\n        commits(last: 1) {\n          nodes {\n            commit {\n              oid\n              statusCheckRollup {\n                state\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n": typeof types.PullCheckDocument,
    "\n  mutation MarkFileViewed($pullRequestId: ID!, $path: String!) {\n    markFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {\n      clientMutationId\n    }\n  }\n": typeof types.MarkFileViewedDocument,
    "\n  mutation UnmarkFileViewed($pullRequestId: ID!, $path: String!) {\n    unmarkFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {\n      clientMutationId\n    }\n  }\n": typeof types.UnmarkFileViewedDocument,
    "\n  query ViewerLogin {\n    viewer {\n      login\n    }\n  }\n": typeof types.ViewerLoginDocument,
    "\n  query PendingReview(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $viewer: String!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        reviews(first: 1, author: $viewer, states: [PENDING]) {\n          nodes {\n            id\n            databaseId\n            state\n          }\n        }\n      }\n    }\n  }\n": typeof types.PendingReviewDocument,
    "\n  mutation AddReview($pullRequestId: ID!) {\n    addPullRequestReview(input: { pullRequestId: $pullRequestId }) {\n      pullRequestReview {\n        id\n        databaseId\n      }\n    }\n  }\n": typeof types.AddReviewDocument,
    "\n  mutation AddReviewThread($input: AddPullRequestReviewThreadInput!) {\n    addPullRequestReviewThread(input: $input) {\n      thread {\n        ...ReviewThreadFields\n        comments(first: 1) {\n          nodes {\n            ...ReviewCommentFields\n          }\n        }\n      }\n    }\n  }\n": typeof types.AddReviewThreadDocument,
    "\n  mutation DeleteReviewComment($id: ID!) {\n    deletePullRequestReviewComment(input: { id: $id }) {\n      clientMutationId\n    }\n  }\n": typeof types.DeleteReviewCommentDocument,
    "\n  query TeamReviews(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $last: Int!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        reviews(last: $last) {\n          nodes {\n            databaseId\n            state\n            submittedAt\n            url\n            bodyText\n            viewerDidAuthor\n            author {\n              kind: __typename\n              login\n              avatarUrl\n            }\n            comments {\n              totalCount\n            }\n          }\n        }\n      }\n    }\n  }\n": typeof types.TeamReviewsDocument,
    "\n  query CommitOid($owner: String!, $repo: String!, $rev: String!) {\n    repository(owner: $owner, name: $repo) {\n      object(expression: $rev) {\n        ... on Commit {\n          oid\n          parents(first: 1) {\n            nodes {\n              oid\n            }\n          }\n        }\n      }\n    }\n  }\n": typeof types.CommitOidDocument,
    "\n  fragment DeployedCommit on Commit {\n    oid\n    statusCheckRollup {\n      state\n    }\n    deployments(\n      first: $deployments\n      orderBy: { field: CREATED_AT, direction: DESC }\n    ) {\n      nodes {\n        databaseId\n        environment\n        description\n        createdAt\n        state\n        creator {\n          login\n          avatarUrl\n        }\n        ref {\n          name\n        }\n        latestStatus {\n          state\n          environmentUrl\n          logUrl\n        }\n      }\n    }\n  }\n": typeof types.DeployedCommitFragmentDoc,
    "\n  query DeploymentsOfPull(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $commits: Int!\n    $deployments: Int!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        headRefName\n        headRefOid\n        commits(last: $commits) {\n          nodes {\n            commit {\n              ...DeployedCommit\n            }\n          }\n        }\n      }\n    }\n  }\n": typeof types.DeploymentsOfPullDocument,
    "\n  query DeploymentsOfCommit(\n    $owner: String!\n    $repo: String!\n    $expression: String!\n    $deployments: Int!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      object(expression: $expression) {\n        ...DeployedCommit\n      }\n    }\n  }\n": typeof types.DeploymentsOfCommitDocument,
};
const documents: Documents = {
    "\n  fragment ReviewThreadFields on PullRequestReviewThread {\n    id\n    isResolved\n    path\n    line\n    originalLine\n    startLine\n    originalStartLine\n    diffSide\n    startDiffSide\n  }\n": types.ReviewThreadFieldsFragmentDoc,
    "\n  fragment ReviewCommentFields on PullRequestReviewComment {\n    databaseId\n    id\n    author {\n      __typename\n      login\n      avatarUrl\n    }\n    body\n    bodyHTML\n    createdAt\n    url\n    pullRequestReview {\n      databaseId\n      state\n    }\n  }\n": types.ReviewCommentFieldsFragmentDoc,
    "\n  query ReviewThreads(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $first: Int!\n    $after: String\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        reviewThreads(first: $first, after: $after) {\n          pageInfo {\n            hasNextPage\n            endCursor\n          }\n          nodes {\n            ...ReviewThreadFields\n            comments(first: 100) {\n              nodes {\n                ...ReviewCommentFields\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n": types.ReviewThreadsDocument,
    "\n  mutation ResolveReviewThread($threadId: ID!) {\n    resolveReviewThread(input: { threadId: $threadId }) {\n      clientMutationId\n    }\n  }\n": types.ResolveReviewThreadDocument,
    "\n  mutation UnresolveReviewThread($threadId: ID!) {\n    unresolveReviewThread(input: { threadId: $threadId }) {\n      clientMutationId\n    }\n  }\n": types.UnresolveReviewThreadDocument,
    "\n  query OpenPulls($owner: String!, $repo: String!, $first: Int!) {\n    viewer {\n      login\n    }\n    repository(owner: $owner, name: $repo) {\n      pullRequests(\n        states: OPEN\n        first: $first\n        orderBy: { field: UPDATED_AT, direction: DESC }\n      ) {\n        nodes {\n          number\n          title\n          url\n          isDraft\n          updatedAt\n          headRefName\n          baseRefName\n          headRefOid\n          reviewDecision\n          author {\n            login\n            avatarUrl\n          }\n          commits(last: 1) {\n            nodes {\n              commit {\n                oid\n                committedDate\n                statusCheckRollup {\n                  state\n                }\n              }\n            }\n          }\n          reviews(last: 1, states: [CHANGES_REQUESTED]) {\n            nodes {\n              submittedAt\n            }\n          }\n          latestOpinionatedReviews(first: 20) {\n            nodes {\n              state\n            }\n          }\n          reviewRequests(first: 20) {\n            nodes {\n              requestedReviewer {\n                ... on User {\n                  login\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n": types.OpenPullsDocument,
    "\n  query MyReview($owner: String!, $repo: String!, $number: Int!) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        viewerLatestReview {\n          databaseId\n          state\n          submittedAt\n          url\n        }\n      }\n    }\n  }\n": types.MyReviewDocument,
    "\n  query ViewedFiles(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $first: Int!\n    $after: String\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        files(first: $first, after: $after) {\n          pageInfo {\n            hasNextPage\n            endCursor\n          }\n          nodes {\n            path\n            viewerViewedState\n          }\n        }\n      }\n    }\n  }\n": types.ViewedFilesDocument,
    "\n  query PullNodeId($owner: String!, $repo: String!, $number: Int!) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        id\n      }\n    }\n  }\n": types.PullNodeIdDocument,
    "\n  query PullCheck($owner: String!, $repo: String!, $number: Int!) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        headRefOid\n        commits(last: 1) {\n          nodes {\n            commit {\n              oid\n              statusCheckRollup {\n                state\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n": types.PullCheckDocument,
    "\n  mutation MarkFileViewed($pullRequestId: ID!, $path: String!) {\n    markFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {\n      clientMutationId\n    }\n  }\n": types.MarkFileViewedDocument,
    "\n  mutation UnmarkFileViewed($pullRequestId: ID!, $path: String!) {\n    unmarkFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {\n      clientMutationId\n    }\n  }\n": types.UnmarkFileViewedDocument,
    "\n  query ViewerLogin {\n    viewer {\n      login\n    }\n  }\n": types.ViewerLoginDocument,
    "\n  query PendingReview(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $viewer: String!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        reviews(first: 1, author: $viewer, states: [PENDING]) {\n          nodes {\n            id\n            databaseId\n            state\n          }\n        }\n      }\n    }\n  }\n": types.PendingReviewDocument,
    "\n  mutation AddReview($pullRequestId: ID!) {\n    addPullRequestReview(input: { pullRequestId: $pullRequestId }) {\n      pullRequestReview {\n        id\n        databaseId\n      }\n    }\n  }\n": types.AddReviewDocument,
    "\n  mutation AddReviewThread($input: AddPullRequestReviewThreadInput!) {\n    addPullRequestReviewThread(input: $input) {\n      thread {\n        ...ReviewThreadFields\n        comments(first: 1) {\n          nodes {\n            ...ReviewCommentFields\n          }\n        }\n      }\n    }\n  }\n": types.AddReviewThreadDocument,
    "\n  mutation DeleteReviewComment($id: ID!) {\n    deletePullRequestReviewComment(input: { id: $id }) {\n      clientMutationId\n    }\n  }\n": types.DeleteReviewCommentDocument,
    "\n  query TeamReviews(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $last: Int!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        reviews(last: $last) {\n          nodes {\n            databaseId\n            state\n            submittedAt\n            url\n            bodyText\n            viewerDidAuthor\n            author {\n              kind: __typename\n              login\n              avatarUrl\n            }\n            comments {\n              totalCount\n            }\n          }\n        }\n      }\n    }\n  }\n": types.TeamReviewsDocument,
    "\n  query CommitOid($owner: String!, $repo: String!, $rev: String!) {\n    repository(owner: $owner, name: $repo) {\n      object(expression: $rev) {\n        ... on Commit {\n          oid\n          parents(first: 1) {\n            nodes {\n              oid\n            }\n          }\n        }\n      }\n    }\n  }\n": types.CommitOidDocument,
    "\n  fragment DeployedCommit on Commit {\n    oid\n    statusCheckRollup {\n      state\n    }\n    deployments(\n      first: $deployments\n      orderBy: { field: CREATED_AT, direction: DESC }\n    ) {\n      nodes {\n        databaseId\n        environment\n        description\n        createdAt\n        state\n        creator {\n          login\n          avatarUrl\n        }\n        ref {\n          name\n        }\n        latestStatus {\n          state\n          environmentUrl\n          logUrl\n        }\n      }\n    }\n  }\n": types.DeployedCommitFragmentDoc,
    "\n  query DeploymentsOfPull(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $commits: Int!\n    $deployments: Int!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        headRefName\n        headRefOid\n        commits(last: $commits) {\n          nodes {\n            commit {\n              ...DeployedCommit\n            }\n          }\n        }\n      }\n    }\n  }\n": types.DeploymentsOfPullDocument,
    "\n  query DeploymentsOfCommit(\n    $owner: String!\n    $repo: String!\n    $expression: String!\n    $deployments: Int!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      object(expression: $expression) {\n        ...DeployedCommit\n      }\n    }\n  }\n": types.DeploymentsOfCommitDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ReviewThreadFields on PullRequestReviewThread {\n    id\n    isResolved\n    path\n    line\n    originalLine\n    startLine\n    originalStartLine\n    diffSide\n    startDiffSide\n  }\n"): typeof import('./graphql').ReviewThreadFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment ReviewCommentFields on PullRequestReviewComment {\n    databaseId\n    id\n    author {\n      __typename\n      login\n      avatarUrl\n    }\n    body\n    bodyHTML\n    createdAt\n    url\n    pullRequestReview {\n      databaseId\n      state\n    }\n  }\n"): typeof import('./graphql').ReviewCommentFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ReviewThreads(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $first: Int!\n    $after: String\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        reviewThreads(first: $first, after: $after) {\n          pageInfo {\n            hasNextPage\n            endCursor\n          }\n          nodes {\n            ...ReviewThreadFields\n            comments(first: 100) {\n              nodes {\n                ...ReviewCommentFields\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').ReviewThreadsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ResolveReviewThread($threadId: ID!) {\n    resolveReviewThread(input: { threadId: $threadId }) {\n      clientMutationId\n    }\n  }\n"): typeof import('./graphql').ResolveReviewThreadDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UnresolveReviewThread($threadId: ID!) {\n    unresolveReviewThread(input: { threadId: $threadId }) {\n      clientMutationId\n    }\n  }\n"): typeof import('./graphql').UnresolveReviewThreadDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OpenPulls($owner: String!, $repo: String!, $first: Int!) {\n    viewer {\n      login\n    }\n    repository(owner: $owner, name: $repo) {\n      pullRequests(\n        states: OPEN\n        first: $first\n        orderBy: { field: UPDATED_AT, direction: DESC }\n      ) {\n        nodes {\n          number\n          title\n          url\n          isDraft\n          updatedAt\n          headRefName\n          baseRefName\n          headRefOid\n          reviewDecision\n          author {\n            login\n            avatarUrl\n          }\n          commits(last: 1) {\n            nodes {\n              commit {\n                oid\n                committedDate\n                statusCheckRollup {\n                  state\n                }\n              }\n            }\n          }\n          reviews(last: 1, states: [CHANGES_REQUESTED]) {\n            nodes {\n              submittedAt\n            }\n          }\n          latestOpinionatedReviews(first: 20) {\n            nodes {\n              state\n            }\n          }\n          reviewRequests(first: 20) {\n            nodes {\n              requestedReviewer {\n                ... on User {\n                  login\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').OpenPullsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyReview($owner: String!, $repo: String!, $number: Int!) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        viewerLatestReview {\n          databaseId\n          state\n          submittedAt\n          url\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').MyReviewDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ViewedFiles(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $first: Int!\n    $after: String\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        files(first: $first, after: $after) {\n          pageInfo {\n            hasNextPage\n            endCursor\n          }\n          nodes {\n            path\n            viewerViewedState\n          }\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').ViewedFilesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query PullNodeId($owner: String!, $repo: String!, $number: Int!) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        id\n      }\n    }\n  }\n"): typeof import('./graphql').PullNodeIdDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query PullCheck($owner: String!, $repo: String!, $number: Int!) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        headRefOid\n        commits(last: 1) {\n          nodes {\n            commit {\n              oid\n              statusCheckRollup {\n                state\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').PullCheckDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation MarkFileViewed($pullRequestId: ID!, $path: String!) {\n    markFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {\n      clientMutationId\n    }\n  }\n"): typeof import('./graphql').MarkFileViewedDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UnmarkFileViewed($pullRequestId: ID!, $path: String!) {\n    unmarkFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {\n      clientMutationId\n    }\n  }\n"): typeof import('./graphql').UnmarkFileViewedDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ViewerLogin {\n    viewer {\n      login\n    }\n  }\n"): typeof import('./graphql').ViewerLoginDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query PendingReview(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $viewer: String!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        reviews(first: 1, author: $viewer, states: [PENDING]) {\n          nodes {\n            id\n            databaseId\n            state\n          }\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').PendingReviewDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AddReview($pullRequestId: ID!) {\n    addPullRequestReview(input: { pullRequestId: $pullRequestId }) {\n      pullRequestReview {\n        id\n        databaseId\n      }\n    }\n  }\n"): typeof import('./graphql').AddReviewDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AddReviewThread($input: AddPullRequestReviewThreadInput!) {\n    addPullRequestReviewThread(input: $input) {\n      thread {\n        ...ReviewThreadFields\n        comments(first: 1) {\n          nodes {\n            ...ReviewCommentFields\n          }\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').AddReviewThreadDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteReviewComment($id: ID!) {\n    deletePullRequestReviewComment(input: { id: $id }) {\n      clientMutationId\n    }\n  }\n"): typeof import('./graphql').DeleteReviewCommentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TeamReviews(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $last: Int!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        reviews(last: $last) {\n          nodes {\n            databaseId\n            state\n            submittedAt\n            url\n            bodyText\n            viewerDidAuthor\n            author {\n              kind: __typename\n              login\n              avatarUrl\n            }\n            comments {\n              totalCount\n            }\n          }\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').TeamReviewsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CommitOid($owner: String!, $repo: String!, $rev: String!) {\n    repository(owner: $owner, name: $repo) {\n      object(expression: $rev) {\n        ... on Commit {\n          oid\n          parents(first: 1) {\n            nodes {\n              oid\n            }\n          }\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').CommitOidDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment DeployedCommit on Commit {\n    oid\n    statusCheckRollup {\n      state\n    }\n    deployments(\n      first: $deployments\n      orderBy: { field: CREATED_AT, direction: DESC }\n    ) {\n      nodes {\n        databaseId\n        environment\n        description\n        createdAt\n        state\n        creator {\n          login\n          avatarUrl\n        }\n        ref {\n          name\n        }\n        latestStatus {\n          state\n          environmentUrl\n          logUrl\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').DeployedCommitFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query DeploymentsOfPull(\n    $owner: String!\n    $repo: String!\n    $number: Int!\n    $commits: Int!\n    $deployments: Int!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      pullRequest(number: $number) {\n        headRefName\n        headRefOid\n        commits(last: $commits) {\n          nodes {\n            commit {\n              ...DeployedCommit\n            }\n          }\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').DeploymentsOfPullDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query DeploymentsOfCommit(\n    $owner: String!\n    $repo: String!\n    $expression: String!\n    $deployments: Int!\n  ) {\n    repository(owner: $owner, name: $repo) {\n      object(expression: $expression) {\n        ...DeployedCommit\n      }\n    }\n  }\n"): typeof import('./graphql').DeploymentsOfCommitDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
