import { useAppData } from '@/components/AppDataProvider';
import { findGitLabHost } from '@/lib/forges';

/**
 * Whether a GitLab host has an OAuth application on this deployment, which is
 * what decides between the one-press sign-in and the personal access token.
 * The instance answer arrives with the page, so this answers from the first
 * render; it is undefined only when no host was named. False when the host is
 * a PAT host — a connect form that cannot learn the answer still has the
 * token path to offer, which is the universal one.
 */
export function useGitLabOAuth(host: string | undefined): boolean | undefined {
  const { instance } = useAppData();
  if (host == null || host.length === 0) return undefined;
  const found = findGitLabHost(instance.gitlab.hosts, host);
  return found?.oauth === true;
}
