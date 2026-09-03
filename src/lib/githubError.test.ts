import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { gitHubErrorMessage } from './githubError.ts';

describe('gitHubErrorMessage', () => {
  it("prefers GitHub's own reason over the status name", () => {
    // The case this function exists for. A reviewer who tried to approve their
    // own pull request was shown "Unprocessable Entity", which is the status
    // name — GitHub had said why, one level down, and it was discarded.
    const body = JSON.stringify({
      message: 'Unprocessable Entity',
      errors: [
        {
          resource: 'PullRequestReview',
          code: 'custom',
          field: 'user_id',
          message: 'Can not approve your own pull request',
        },
      ],
      documentation_url: 'https://docs.github.com/rest/pulls/reviews',
    });
    assert.equal(
      gitHubErrorMessage(body, 'Unprocessable Entity'),
      'Can not approve your own pull request'
    );
  });

  it('keeps the top-level message when there is no errors array', () => {
    // Every other failure GitHub sends, and the behaviour that must not change.
    for (const message of [
      'Not Found',
      'Bad credentials',
      'API rate limit exceeded for 203.0.113.7.',
    ]) {
      assert.equal(
        gitHubErrorMessage(JSON.stringify({ message }), 'x'),
        message
      );
    }
  });

  it('falls back to the top level when no error entry carries a sentence', () => {
    // A validation entry can be all machine fields and no prose.
    const body = JSON.stringify({
      message: 'Validation Failed',
      errors: [
        { resource: 'PullRequest', field: 'head', code: 'missing_field' },
      ],
    });
    assert.equal(gitHubErrorMessage(body, 'x'), 'Validation Failed');
  });

  it('skips an entry with a blank message and takes the next one', () => {
    const body = JSON.stringify({
      message: 'Unprocessable Entity',
      errors: [{ message: '   ' }, { message: 'The real reason' }],
    });
    assert.equal(gitHubErrorMessage(body, 'x'), 'The real reason');
  });

  it('answers with the raw body when it is not JSON', () => {
    assert.equal(
      gitHubErrorMessage(
        'Request forbidden by administrative rules',
        'Forbidden'
      ),
      'Request forbidden by administrative rules'
    );
  });

  it('answers with the status text for an empty body', () => {
    assert.equal(gitHubErrorMessage('', 'Bad Gateway'), 'Bad Gateway');
    assert.equal(gitHubErrorMessage('   ', 'Bad Gateway'), 'Bad Gateway');
  });

  it('does not fall over on a JSON body that is not an object', () => {
    assert.equal(gitHubErrorMessage('null', 'Bad Gateway'), 'null');
    assert.equal(gitHubErrorMessage('42', 'Bad Gateway'), '42');
    assert.equal(gitHubErrorMessage('"a string"', 'Bad Gateway'), '"a string"');
  });
});
