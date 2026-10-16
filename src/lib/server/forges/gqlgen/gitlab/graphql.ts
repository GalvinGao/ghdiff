/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
export type PipelineStatusEnum =
  /** Pipeline was canceled before completion. */
  | 'CANCELED'
  /** Pipeline is in the process of canceling. */
  | 'CANCELING'
  /** Pipeline has been created. */
  | 'CREATED'
  /** At least one stage of the pipeline failed. */
  | 'FAILED'
  /** Pipeline needs to be manually started. */
  | 'MANUAL'
  /** Pipeline has not started running yet. */
  | 'PENDING'
  /** Pipeline is preparing to run. */
  | 'PREPARING'
  /** Pipeline is running. */
  | 'RUNNING'
  /** Pipeline is scheduled to run. */
  | 'SCHEDULED'
  /** Pipeline was skipped. */
  | 'SKIPPED'
  /** Pipeline completed successfully. */
  | 'SUCCESS'
  /** Pipeline is waiting for an external action. */
  | 'WAITING_FOR_CALLBACK'
  /** A resource (for example, a runner) that the pipeline requires to run is unavailable. */
  | 'WAITING_FOR_RESOURCE';

export type OpenMergeRequestsQueryVariables = Exact<{
  path: string | number;
  first: number;
}>;


export type OpenMergeRequestsQuery = { currentUser: { username: string } | null, project: { mergeRequests: { nodes: Array<{ iid: string, title: string, draft: boolean, webUrl: string | null, updatedAt: string, sourceBranch: string, targetBranch: string, author: { username: string, avatarUrl: string | null } | null, headPipeline: { status: PipelineStatusEnum } | null, approvedBy: { nodes: Array<{ id: unknown } | null> | null } | null, reviewers: { nodes: Array<{ username: string } | null> | null } | null } | null> | null } | null } | null };

export type MyMergeRequestApprovalQueryVariables = Exact<{
  path: string | number;
  iid: string;
}>;


export type MyMergeRequestApprovalQuery = { currentUser: { username: string } | null, project: { mergeRequest: { approvedBy: { nodes: Array<{ username: string } | null> | null } | null } | null } | null };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}

export const OpenMergeRequestsDocument = new TypedDocumentString(`
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
    `) as unknown as TypedDocumentString<OpenMergeRequestsQuery, OpenMergeRequestsQueryVariables>;
export const MyMergeRequestApprovalDocument = new TypedDocumentString(`
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
    `) as unknown as TypedDocumentString<MyMergeRequestApprovalQuery, MyMergeRequestApprovalQueryVariables>;