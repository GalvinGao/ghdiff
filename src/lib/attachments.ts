// The files a body attaches, and the addresses a browser can actually load.
//
// A picture or a video dropped into a GitHub editor is written into the body as
// `https://github.com/user-attachments/assets/<uuid>`. On a private repository
// that address answers only a request carrying GitHub's own credentials, and a
// browser sends none from ghdiff.com: the github.com session cookie does not
// travel on a cross-site `<img>`, so the description drew a broken picture.
//
// What GitHub does give away is `body_html`, asked for with the `full` media
// type. There every attachment is already rewritten to a signed address on
// `private-user-images.githubusercontent.com`, good for five minutes, and a
// bare attachment link on its own line is already a `<video>`. So the server
// reads that HTML for its media and nothing else, and hands the browser a map
// from each attachment's uuid to the address GitHub signed. The markdown is
// still what is rendered: `body_html` is GitHub's layout with GitHub's classes,
// and it would have to be sanitized all over again to replace a pipeline that
// already works.
//
// The uuid is the key because it is the one part both sides share. The body
// names it in the path, and the signed address names it in the file name,
// after the numeric asset id: `/82765353/660046017-<uuid>.png`.

export type AttachmentKind = 'image' | 'video';

export interface SignedAttachment {
  url: string;
  kind: AttachmentKind;
}

export interface SignedAttachments {
  /** The address to load, by attachment uuid. */
  byId: Record<string, SignedAttachment>;
  /**
   * How long the shortest signature among them lasts, in milliseconds. Read
   * from the token's own `nbf` and `exp`, so the figure is a length and owes
   * nothing to whose clock is right. Absent when none of them is signed.
   */
  lifetimeMs?: number;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** `github.com/user-attachments/assets/<uuid>`, the address editors write now. */
const ATTACHMENT_PATH = new RegExp(`^/user-attachments/assets/(${UUID})$`, 'i');
/** `github.com/<owner>/<repo>/assets/<user id>/<uuid>`, the one before it. */
const REPO_ASSET_PATH = new RegExp(`^/[^/]+/[^/]+/assets/\\d+/(${UUID})$`, 'i');
/** `<user id>/<asset id>-<uuid>.<ext>`, on either image host. */
const IMAGE_HOST_PATH = new RegExp(`^/\\d+/\\d+-(${UUID})\\.[a-z0-9]+$`, 'i');

const IMAGE_HOSTS = new Set([
  'private-user-images.githubusercontent.com',
  'user-images.githubusercontent.com',
]);

/** The attachment an address names, or nothing if it names none. */
export function attachmentId(address: string): string | undefined {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  const pattern =
    url.hostname === 'github.com'
      ? [ATTACHMENT_PATH, REPO_ASSET_PATH]
      : IMAGE_HOSTS.has(url.hostname)
        ? [IMAGE_HOST_PATH]
        : [];
  for (const test of pattern) {
    const match = test.exec(url.pathname);
    if (match?.[1] != null) return match[1].toLowerCase();
  }
  return undefined;
}

// GitHub's own HTML is well formed and quotes every attribute with `"`, and
// only two elements in it carry an attachment, so this reads the `src` of each
// and does not pretend to parse HTML. A tag it cannot read is a picture left
// as it was, never a wrong one: the address it would find has to name an
// attachment before it is used.
const MEDIA_TAG = /<(img|video)\b[^>]*?\ssrc="([^"]+)"/gi;

/** What `body_html` signed, keyed by the attachment each address is for. */
export function readSignedAttachments(
  html: string | null | undefined
): SignedAttachments {
  const byId: Record<string, SignedAttachment> = {};
  let lifetimeMs: number | undefined;
  if (html == null) return { byId };

  for (const [, tag, rawSrc] of html.matchAll(MEDIA_TAG)) {
    if (tag == null || rawSrc == null) continue;
    const url = rawSrc.replaceAll('&amp;', '&');
    const id = attachmentId(url);
    if (id == null) continue;
    byId[id] = { url, kind: tag.toLowerCase() === 'video' ? 'video' : 'image' };
    const lifetime = signatureLifetimeMs(url);
    if (lifetime != null) {
      lifetimeMs =
        lifetimeMs == null ? lifetime : Math.min(lifetimeMs, lifetime);
    }
  }
  return lifetimeMs == null ? { byId } : { byId, lifetimeMs };
}

/** `exp - nbf` of the `jwt` a signed address carries, in milliseconds. */
export function signatureLifetimeMs(address: string): number | undefined {
  let jwt: string | null;
  try {
    jwt = new URL(address).searchParams.get('jwt');
  } catch {
    return undefined;
  }
  const payload = jwt?.split('.')[1];
  if (payload == null) return undefined;
  try {
    const padded = payload.replaceAll('-', '+').replaceAll('_', '/');
    const claims = JSON.parse(atob(padded)) as { exp?: unknown; nbf?: unknown };
    const { exp, nbf } = claims;
    if (typeof exp !== 'number' || typeof nbf !== 'number' || exp <= nbf) {
      return undefined;
    }
    return (exp - nbf) * 1000;
  } catch {
    return undefined;
  }
}

/** The address a browser should load for `src`, and what kind of file it is. */
export function resolveAttachment(
  src: string | undefined,
  attachments: Record<string, SignedAttachment> | undefined
): SignedAttachment | undefined {
  if (src == null || attachments == null) return undefined;
  const id = attachmentId(src);
  return id == null ? undefined : attachments[id];
}

/**
 * One map for many bodies. Review comments arrive as a list and a thread card
 * reads whichever of them it draws, so they share one set of addresses, and the
 * shortest signature among them is the one that decides when to renew.
 */
export function mergeSignedAttachments(
  sets: readonly (SignedAttachments | undefined)[]
): SignedAttachments {
  const byId: Record<string, SignedAttachment> = {};
  let lifetimeMs: number | undefined;
  for (const set of sets) {
    if (set == null) continue;
    Object.assign(byId, set.byId);
    if (set.lifetimeMs != null) {
      lifetimeMs =
        lifetimeMs == null
          ? set.lifetimeMs
          : Math.min(lifetimeMs, set.lifetimeMs);
    }
  }
  return lifetimeMs == null ? { byId } : { byId, lifetimeMs };
}
