// Reading what a reviewer pasted into the open-a-review box, in one place so
// no two entry points can drift: the home page's box and the deployment's
// configured examples both go through `reviewInputFrom`.

import { forgeOfHost } from '@/lib/forges';
import {
  type ForgeTarget,
  pathShapeOf,
  reviewTargetFromSegments,
  segmentsFromPath,
  splitColonHost,
  targetFromPathShape,
} from '@/lib/reviewTarget';

/**
 * What one input to the open-a-review box came to: a target to navigate to,
 * or nothing this app has an address for.
 */
export type ReviewInput =
  | { kind: 'target'; target: ForgeTarget }
  | { kind: 'none' };

/**
 * Reads whatever the reviewer pasted into the box: the shorthand
 * (`owner/repo#123`), a github.com URL (with a trailing tab or a `.diff`
 * suffix still naming the same review), this deployment's own URL in the
 * canonical colon form, and the colon form typed bare.
 */
export function reviewInputFrom(
  input: string,
  options: { ownHost?: string } = {}
): ReviewInput {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { kind: 'none' };

  const shorthand = /^([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)#(\d+)$/.exec(
    trimmed
  );
  if (shorthand != null) {
    const path = shorthand[1].split('/');
    // A GitHub repository is exactly owner/repo, and the shorthand names no
    // host for a deeper path to belong to.
    if (path.length !== 2) return { kind: 'none' };
    return {
      kind: 'target',
      target: {
        kind: 'github-pull',
        owner: path[0],
        repo: path[1],
        number: Number(shorthand[2]),
      },
    };
  }

  let url: URL | undefined;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    url = undefined;
  }
  if (url != null) {
    const host = url.host.toLowerCase();
    if (options.ownHost != null && host === options.ownHost.toLowerCase()) {
      const target = reviewTargetFromSegments(segmentsFromPath(url.pathname));
      return target == null ? { kind: 'none' } : { kind: 'target', target };
    }
    // GitHub's own host speaks for the URL, parsed whether or not the
    // deployment serves it — that is the forge gate's question. Anything else
    // was probably a bare path, not a URL, and the branch below reads it as
    // one.
    if (forgeOfHost(host) === 'github') {
      const path = url.pathname
        .replace(/\/(files|changes|diffs)\/?$/, '/')
        .replace(/\.(diff|patch)(?=\/?$)/, '')
        .replace(/^\/+|\/+$/g, '');
      const shape = pathShapeOf(path);
      if (shape == null) return { kind: 'none' };
      const target = targetFromPathShape(shape, host);
      return target == null ? { kind: 'none' } : { kind: 'target', target };
    }
  }

  const segments = segmentsFromPath(trimmed);
  if (splitColonHost(segments[0] ?? '') != null) {
    const target = reviewTargetFromSegments(segments);
    return target == null ? { kind: 'none' } : { kind: 'target', target };
  }
  return { kind: 'none' };
}
