import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { mediaSrc } from './mediaUrl';
import type {
  GitHubPullTarget,
  GitLabMergeRequestTarget,
} from './reviewTarget';

const GITLAB: GitLabMergeRequestTarget = {
  kind: 'gitlab-mr',
  host: 'gitlab.corp.com',
  project: 'group/sub/repo',
  number: 42,
};

const GITHUB: GitHubPullTarget = {
  kind: 'github-pull',
  owner: 'octo',
  repo: 'repo',
  number: 7,
};

function proxiedUrl(src: string): string {
  const parsed = new URL(src, 'https://ghdiff.test');
  assert.equal(parsed.pathname, '/api/media');
  assert.equal(parsed.searchParams.get('kind'), 'gitlab-mr');
  assert.equal(parsed.searchParams.get('host'), 'gitlab.corp.com');
  assert.equal(parsed.searchParams.get('project'), 'group/sub/repo');
  assert.equal(parsed.searchParams.get('number'), '42');
  return parsed.searchParams.get('url') ?? '';
}

describe('mediaSrc', () => {
  it('proxies a root-relative upload on the target’s instance', () => {
    const src = mediaSrc('/uploads/abc123/image.png', GITLAB);
    assert.equal(proxiedUrl(src), '/uploads/abc123/image.png');
  });

  it('proxies an absolute URL on the target’s host', () => {
    const src = mediaSrc(
      'https://gitlab.corp.com/group/sub/repo/uploads/abc123/image.png',
      GITLAB
    );
    assert.equal(
      proxiedUrl(src),
      'https://gitlab.corp.com/group/sub/repo/uploads/abc123/image.png'
    );
  });

  it('reads a protocol-relative URL as https and matches the host caselessly', () => {
    const src = mediaSrc('//GitLab.CORP.com/uploads/abc123/image.png', GITLAB);
    assert.equal(
      proxiedUrl(src),
      'https://gitlab.corp.com/uploads/abc123/image.png'
    );
  });

  it('leaves a foreign host alone', () => {
    const src = 'https://example.com/image.png';
    assert.equal(mediaSrc(src, GITLAB), src);
  });

  it('leaves a data URL alone', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    assert.equal(mediaSrc(src, GITLAB), src);
  });

  it('proxies a GitHub attachment address', () => {
    const src = mediaSrc(
      'https://github.com/octo/repo/assets/123/abc.png',
      GITHUB
    );
    const parsed = new URL(src, 'https://ghdiff.test');
    assert.equal(parsed.pathname, '/api/media');
    assert.equal(parsed.searchParams.get('kind'), 'github-pull');
    assert.equal(parsed.searchParams.get('owner'), 'octo');
    assert.equal(
      parsed.searchParams.get('url'),
      'https://github.com/octo/repo/assets/123/abc.png'
    );
  });

  it('proxies a raw GitHub file address', () => {
    const src = mediaSrc(
      'https://raw.githubusercontent.com/octo/repo/main/doc/figure.png',
      GITHUB
    );
    const parsed = new URL(src, 'https://ghdiff.test');
    assert.equal(parsed.pathname, '/api/media');
  });

  it('leaves public GitHub image hosts alone', () => {
    const legacy = 'https://user-images.githubusercontent.com/1/2.png';
    assert.equal(mediaSrc(legacy, GITHUB), legacy);
    const avatar = 'https://avatars.githubusercontent.com/u/1';
    assert.equal(mediaSrc(avatar, GITHUB), avatar);
  });

  it('leaves a non-attachment github.com address alone', () => {
    const blob = 'https://github.com/octo/repo/blob/main/doc/figure.png';
    assert.equal(mediaSrc(blob, GITHUB), blob);
  });

  it('leaves a plaintext GitHub address alone', () => {
    // The proxy fetches HTTPS only, so the browser keeps a plaintext address.
    const assets = 'http://github.com/octo/repo/assets/123/abc.png';
    assert.equal(mediaSrc(assets, GITHUB), assets);
  });

  it('leaves a plaintext same-host GitLab address alone', () => {
    const upload = 'http://gitlab.corp.com/uploads/abc123/image.png';
    assert.equal(mediaSrc(upload, GITLAB), upload);
  });

  it('leaves a relative address alone on a GitHub target', () => {
    const relative = '/uploads/abc123/image.png';
    assert.equal(mediaSrc(relative, GITHUB), relative);
  });

  it('leaves everything alone with no target at all', () => {
    const upload = '/uploads/abc123/image.png';
    assert.equal(mediaSrc(upload, undefined), upload);
    const assets = 'https://github.com/octo/repo/assets/123/abc.png';
    assert.equal(mediaSrc(assets, undefined), assets);
  });

  it('leaves an unparseable address alone', () => {
    const src = 'not a url at all';
    assert.equal(mediaSrc(src, GITLAB), src);
  });
});
