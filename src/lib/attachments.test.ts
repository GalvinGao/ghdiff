import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attachmentId,
  readSignedAttachments,
  resolveAttachment,
  signatureLifetimeMs,
} from './attachments.ts';

const IMAGE_ID = 'ce918f14-5c5a-4961-b33b-e2c54ccf1ab3';
const VIDEO_ID = 'ba523b05-faca-40a2-b623-3ae39a6d6c75';

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
  return `${encode({ typ: 'JWT', alg: 'HS256' })}.${encode(claims)}.signature`;
}

function signed(name: string, claims = { nbf: 1000, exp: 1300 }): string {
  return `https://private-user-images.githubusercontent.com/82765353/${name}?jwt=${jwt(claims)}`;
}

describe('attachmentId', () => {
  it('reads the address an editor writes into a body', () => {
    assert.equal(
      attachmentId(`https://github.com/user-attachments/assets/${IMAGE_ID}`),
      IMAGE_ID
    );
  });

  it('reads the older repository-scoped address', () => {
    assert.equal(
      attachmentId(`https://github.com/acme/app/assets/82765353/${IMAGE_ID}`),
      IMAGE_ID
    );
  });

  it('reads the uuid out of a signed file name', () => {
    assert.equal(attachmentId(signed(`660046017-${IMAGE_ID}.png`)), IMAGE_ID);
  });

  it('answers the same key whatever the case', () => {
    assert.equal(
      attachmentId(
        `https://github.com/user-attachments/assets/${IMAGE_ID.toUpperCase()}`
      ),
      IMAGE_ID
    );
  });

  it('names nothing for any other address', () => {
    for (const address of [
      `http://github.com/user-attachments/assets/${IMAGE_ID}`,
      `https://example.com/user-attachments/assets/${IMAGE_ID}`,
      `https://github.com/user-attachments/files/${IMAGE_ID}`,
      'https://github.com/user-attachments/assets/not-a-uuid',
      'https://avatars.githubusercontent.com/u/1',
      'not a url',
    ]) {
      assert.equal(attachmentId(address), undefined, address);
    }
  });
});

describe('signatureLifetimeMs', () => {
  it('is the span between the two claims, whatever the clock says', () => {
    assert.equal(signatureLifetimeMs(signed('1-x.png')), 300_000);
  });

  it('is nothing for an address with no token, or a token it cannot read', () => {
    assert.equal(
      signatureLifetimeMs(
        'https://private-user-images.githubusercontent.com/1/2-x.png'
      ),
      undefined
    );
    assert.equal(
      signatureLifetimeMs(
        'https://private-user-images.githubusercontent.com/1/2-x.png?jwt=a.%%%.c'
      ),
      undefined
    );
    assert.equal(
      signatureLifetimeMs(signed('1-x.png', { nbf: 5, exp: 5 })),
      undefined
    );
  });
});

describe('readSignedAttachments', () => {
  it('maps each attachment to the address GitHub signed, with its kind', () => {
    const image = signed(`660046017-${IMAGE_ID}.png`);
    const video = signed(`660046026-${VIDEO_ID}.mp4`, { nbf: 0, exp: 240 });
    const html = [
      `<p><a href="${image}"><img src="${image.replaceAll('&', '&amp;')}" alt="Before" style="max-width: 100%;"></a></p>`,
      `<video src="${video}" data-canonical-src="${video}" controls="controls" muted="muted">`,
    ].join('\n');

    assert.deepEqual(readSignedAttachments(html), {
      byId: {
        [IMAGE_ID]: { url: image, kind: 'image' },
        [VIDEO_ID]: { url: video, kind: 'video' },
      },
      lifetimeMs: 240_000,
    });
  });

  it('decodes an escaped ampersand in the address', () => {
    const html = `<img src="https://private-user-images.githubusercontent.com/1/2-${IMAGE_ID}.png?jwt=a&amp;x=1">`;
    assert.equal(
      readSignedAttachments(html).byId[IMAGE_ID]?.url,
      `https://private-user-images.githubusercontent.com/1/2-${IMAGE_ID}.png?jwt=a&x=1`
    );
  });

  it('ignores media that is not an attachment', () => {
    const html =
      '<img src="https://camo.githubusercontent.com/abc" alt="badge"><img src="https://avatars.githubusercontent.com/u/1">';
    assert.deepEqual(readSignedAttachments(html), { byId: {} });
  });

  it('answers an empty map for no HTML at all', () => {
    assert.deepEqual(readSignedAttachments(undefined), { byId: {} });
    assert.deepEqual(readSignedAttachments(null), { byId: {} });
  });
});

describe('resolveAttachment', () => {
  const byId = { [IMAGE_ID]: { url: signed('x.png'), kind: 'image' as const } };

  it('swaps an attachment address for its signed one', () => {
    assert.equal(
      resolveAttachment(
        `https://github.com/user-attachments/assets/${IMAGE_ID}`,
        byId
      )?.url,
      byId[IMAGE_ID].url
    );
  });

  it('leaves every other address to the caller', () => {
    assert.equal(
      resolveAttachment('https://example.com/a.png', byId),
      undefined
    );
    assert.equal(
      resolveAttachment(
        `https://github.com/user-attachments/assets/${VIDEO_ID}`,
        byId
      ),
      undefined
    );
    assert.equal(resolveAttachment(undefined, byId), undefined);
    assert.equal(
      resolveAttachment(
        `https://github.com/user-attachments/assets/${IMAGE_ID}`,
        undefined
      ),
      undefined
    );
  });
});
