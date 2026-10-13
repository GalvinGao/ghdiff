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
    "\n  query OpenMergeRequests($path: ID!, $first: Int!) {\n    currentUser {\n      username\n    }\n    project(fullPath: $path) {\n      mergeRequests(state: opened, sort: UPDATED_DESC, first: $first) {\n        nodes {\n          iid\n          title\n          draft\n          webUrl\n          updatedAt\n          sourceBranch\n          targetBranch\n          author {\n            username\n            avatarUrl\n          }\n          headPipeline {\n            status\n          }\n          approvedBy(first: 1) {\n            nodes {\n              id\n            }\n          }\n          reviewers(first: 20) {\n            nodes {\n              username\n            }\n          }\n        }\n      }\n    }\n  }\n": typeof types.OpenMergeRequestsDocument,
    "\n  query MyMergeRequestApproval($path: ID!, $iid: String!) {\n    currentUser {\n      username\n    }\n    project(fullPath: $path) {\n      mergeRequest(iid: $iid) {\n        approvedBy(first: 100) {\n          nodes {\n            username\n          }\n        }\n      }\n    }\n  }\n": typeof types.MyMergeRequestApprovalDocument,
};
const documents: Documents = {
    "\n  query OpenMergeRequests($path: ID!, $first: Int!) {\n    currentUser {\n      username\n    }\n    project(fullPath: $path) {\n      mergeRequests(state: opened, sort: UPDATED_DESC, first: $first) {\n        nodes {\n          iid\n          title\n          draft\n          webUrl\n          updatedAt\n          sourceBranch\n          targetBranch\n          author {\n            username\n            avatarUrl\n          }\n          headPipeline {\n            status\n          }\n          approvedBy(first: 1) {\n            nodes {\n              id\n            }\n          }\n          reviewers(first: 20) {\n            nodes {\n              username\n            }\n          }\n        }\n      }\n    }\n  }\n": types.OpenMergeRequestsDocument,
    "\n  query MyMergeRequestApproval($path: ID!, $iid: String!) {\n    currentUser {\n      username\n    }\n    project(fullPath: $path) {\n      mergeRequest(iid: $iid) {\n        approvedBy(first: 100) {\n          nodes {\n            username\n          }\n        }\n      }\n    }\n  }\n": types.MyMergeRequestApprovalDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OpenMergeRequests($path: ID!, $first: Int!) {\n    currentUser {\n      username\n    }\n    project(fullPath: $path) {\n      mergeRequests(state: opened, sort: UPDATED_DESC, first: $first) {\n        nodes {\n          iid\n          title\n          draft\n          webUrl\n          updatedAt\n          sourceBranch\n          targetBranch\n          author {\n            username\n            avatarUrl\n          }\n          headPipeline {\n            status\n          }\n          approvedBy(first: 1) {\n            nodes {\n              id\n            }\n          }\n          reviewers(first: 20) {\n            nodes {\n              username\n            }\n          }\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').OpenMergeRequestsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyMergeRequestApproval($path: ID!, $iid: String!) {\n    currentUser {\n      username\n    }\n    project(fullPath: $path) {\n      mergeRequest(iid: $iid) {\n        approvedBy(first: 100) {\n          nodes {\n            username\n          }\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').MyMergeRequestApprovalDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
