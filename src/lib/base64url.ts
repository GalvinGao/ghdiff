// base64url, both directions.
//
// Node and workerd each supply `atob` and `btoa`, and neither supplies a
// URL-safe variant of either, so the three substitutions are made by hand. It
// sits here rather than beside its first caller because two callers want it: the
// sealed session cookie in `@/lib/server/session`, and the `state` and PKCE
// verifier that the authorization flow generates.
//
// `fromBase64Url` never throws. Every value it is asked to read arrives from a
// browser, and a cookie somebody has edited by hand must read as no cookie at
// all rather than as a failed request.

/** The alphabet, and nothing else. `atob` itself tolerates whitespace. */
const BASE64URL = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(bytes: Uint8Array): string {
  let ascii = '';
  for (const byte of bytes) {
    ascii += String.fromCharCode(byte);
  }
  return btoa(ascii)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/** The bytes a value stands for, or nothing at all if it stands for none. */
export function fromBase64Url(
  text: string
): Uint8Array<ArrayBuffer> | undefined {
  if (!BASE64URL.test(text)) return undefined;
  // A base64 quantum is four characters. Three of the four remainders can be
  // padded back; one character alone encodes no byte and is not valid input.
  const remainder = text.length % 4;
  if (remainder === 1) return undefined;
  const padded =
    text.replaceAll('-', '+').replaceAll('_', '/') +
    '='.repeat(remainder === 0 ? 0 : 4 - remainder);

  try {
    const ascii = atob(padded);
    const bytes = new Uint8Array(ascii.length);
    for (let index = 0; index < ascii.length; index += 1) {
      bytes[index] = ascii.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
}
