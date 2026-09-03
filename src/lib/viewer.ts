/**
 * Who a token belongs to. Every comment ghdiff posts carries this account, so
 * the header names it before anything is typed.
 *
 * It sits here rather than beside the hook that fetches it, because the RPC
 * contract names it too and a contract must not reach into a React hook for a
 * type. `useGitHubSession` re-exports it, so the components that read it are
 * unchanged.
 */
export interface GitHubViewer {
  login: string;
  avatarUrl?: string;
  name?: string | null;
}
