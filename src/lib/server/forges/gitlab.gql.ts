import { graphql } from './gqlgen/gitlab';

// The open merge requests of one project, with the two state axes REST
// answers only per merge request: `approvedBy` is the review axis ("users who
// approved", the same set the approvals endpoint's `approved_by` lists), and
// `headPipeline` is the check one. `currentUser` rides along because the list
// is where the rail learns who the token belongs to. `first: 100` is the page
// cap the REST list answers with, and the query's complexity scores about 40
// against the instance's 250 cap, so the page needs no splitting.
export const OPEN_MERGE_REQUESTS_QUERY = graphql(`
  query OpenMergeRequests($path: ID!, $first: Int!) {
    currentUser {
      username
    }
    project(fullPath: $path) {
      mergeRequests(state: opened, sort: UPDATED_DESC, first: $first) {
        nodes {
          iid
          title
          draft
          webUrl
          updatedAt
          sourceBranch
          targetBranch
          author {
            username
            avatarUrl
          }
          headPipeline {
            status
          }
          approvedBy(first: 1) {
            nodes {
              id
            }
          }
          reviewers(first: 20) {
            nodes {
              username
            }
          }
        }
      }
    }
  }
`);

// Whether the token's own user has approved this merge request — the only
// verdict GitLab keeps — as one query instead of a viewer read plus an
// approvals read.
export const MY_MERGE_REQUEST_APPROVAL_QUERY = graphql(`
  query MyMergeRequestApproval($path: ID!, $iid: String!) {
    currentUser {
      username
    }
    project(fullPath: $path) {
      mergeRequest(iid: $iid) {
        approvedBy(first: 100) {
          nodes {
            username
          }
        }
      }
    }
  }
`);
