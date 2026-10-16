import { isGitHubMediaUrl } from './github/hosts';
import {
  isForgeTarget,
  type ReviewTarget,
  reviewTargetQuery,
} from './reviewTarget';

// Where a comment body's `<img>` should point. A forge-hosted image on a
// private repository answers a browser only to the forge's own session
// cookie — which the reviewer does not have, the sealed grant living on the
// server — so such an image is pointed at `/api/media`, which fetches it with
// the reviewer's credential. Everything else — a foreign host, a data URL, a
// `user-images` or avatar URL that is public already — is left alone: the
// browser loads those as it always could, and the proxy never becomes a
// credentialed GET of anywhere the markup pointed.

function proxied(url: string, target: ReviewTarget): string {
  return `/api/media?${reviewTargetQuery(target)}&url=${encodeURIComponent(url)}`;
}

function absolute(src: string): URL | undefined {
  try {
    return new URL(src.startsWith('//') ? `https:${src}` : src);
  } catch {
    return undefined;
  }
}

function gitHubSrc(src: string, target: ReviewTarget): string {
  const parsed = absolute(src);
  if (parsed == null) return src;
  if (!isGitHubMediaUrl(parsed)) return src;
  return proxied(parsed.toString(), target);
}

export function mediaSrc(
  src: string,
  target: ReviewTarget | undefined
): string {
  // A local diff is on no forge, so nothing it shows needs a grant.
  if (target == null || !isForgeTarget(target)) return src;
  return gitHubSrc(src, target);
}
