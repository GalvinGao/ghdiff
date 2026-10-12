import type { ForgeCredential } from './types';
import { gitHubErrorMessage } from '@/lib/github/error';
import { GitHubError, USER_AGENT } from '@/lib/server/github/client';
import { m } from '@/paraglide/messages.js';

// The streaming half of the media proxy, shared by every forge. What differs
// per forge is where an image address resolves and how the credential travels;
// what does not is here: redirects followed by hand, the image gate, and the
// extension map for an answer whose type was never recorded.

/** A redirect chain is followed this far and no further. */
const MAX_MEDIA_REDIRECTS = 3;

/** The headers one media request is sent with, credential and all. */
export type MediaHeaders = (cred: ForgeCredential) => Record<string, string>;

/** The extensions the content-type gate may map, when the instance says nothing useful. */
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/**
 * The content type an image answer is served with, or nothing when the answer
 * is not an image. The server's own `image/*` wins. An upload whose type was
 * never recorded — a pasted screenshot arrives as
 * `application/octet-stream`, or with no type at all — is mapped from its
 * extension instead; anything else, the `text/html` sign-in page an expired
 * token earns included, is not a picture.
 */
function imageContentType(response: Response, url: string): string | undefined {
  const header = response.headers.get('content-type');
  const type = (header ?? '').split(';', 1)[0].trim().toLowerCase();
  if (type.startsWith('image/')) return header ?? undefined;
  if (type !== '' && type !== 'application/octet-stream') return undefined;
  const extension = new URL(url).pathname.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_CONTENT_TYPES[extension];
}

/**
 * A streamed GET of one image, with the reviewer's credential. Redirects are
 * followed by hand, because a download may leave the host: object storage
 * answers with a presigned URL, and following it is safe only because the
 * credential stays behind — the grant is sent to the host that issued it and
 * never to a host the redirect named. And the answer must be an image: the
 * `text/html` sign-in page an expired token earns is not one.
 */
export async function streamMedia(
  url: string,
  cred: ForgeCredential,
  buildHeaders: MediaHeaders
): Promise<Response> {
  let current = url;
  let credentialed = true;
  for (let hop = 0; ; hop++) {
    const response = await fetch(current, {
      cache: 'no-store',
      headers: credentialed ? buildHeaders(cred) : { 'user-agent': USER_AGENT },
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      // Reading the body out frees the socket; a canceled stream never
      // settles under the test mock.
      await response.text();
      if (location == null || hop >= MAX_MEDIA_REDIRECTS) {
        throw new GitHubError(
          502,
          m.media_the_server_sent_this_image_in_circles()
        );
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new GitHubError(
          502,
          m.media_the_server_sent_this_image_nowhere()
        );
      }
      // The credential follows a hop only to the same origin: scheme and
      // port included, so a redirect down to plain http never carries it.
      if (next.origin !== new URL(current).origin) {
        credentialed = false;
      }
      current = next.toString();
      continue;
    }
    if (!response.ok) {
      throw new GitHubError(
        response.status,
        gitHubErrorMessage(await response.text(), response.statusText)
      );
    }
    const contentType = imageContentType(response, current);
    if (contentType == null) {
      await response.text();
      const answered =
        (response.headers.get('content-type') ?? '').split(';', 1)[0].trim() ||
        m.media_no_content_type();
      throw new GitHubError(
        415,
        m.media_that_is_not_an_image({ type: answered })
      );
    }
    // Re-wrapped so the mapped type, not the server's octet-stream, is what
    // the route passes through.
    return new Response(response.body, {
      status: 200,
      headers: { 'content-type': contentType },
    });
  }
}
