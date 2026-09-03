import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type AppInstallation,
  describeInstallationReach,
  installationForAccount,
  reachesAnyRepository,
} from './installations.ts';

function installation(
  overrides: Partial<AppInstallation> = {}
): AppInstallation {
  return {
    id: 1,
    account: 'acme',
    settingsUrl:
      'https://github.com/organizations/acme/settings/installations/1',
    allRepositories: false,
    repositoryCount: 3,
    ...overrides,
  };
}

describe('describeInstallationReach', () => {
  it('says all repositories without a figure', () => {
    // A count there would be a number that goes stale the next time somebody
    // creates a repository.
    assert.equal(
      describeInstallationReach(
        installation({ allRepositories: true, repositoryCount: undefined })
      ),
      'All repositories'
    );
  });

  it('counts a chosen list, singular and plural', () => {
    assert.equal(
      describeInstallationReach(installation({ repositoryCount: 1 })),
      '1 repository'
    );
    assert.equal(
      describeInstallationReach(installation({ repositoryCount: 3 })),
      '3 repositories'
    );
  });

  it('calls an empty list what it is, and not a plural', () => {
    // The one state that looks like success from every other angle and still
    // answers 404 for every diff, so it gets its own sentence. The sentence
    // itself is `agy -p`'s and may be rewritten; what must hold is that zero
    // does not fall through to "0 repositories".
    const zero = describeInstallationReach(
      installation({ repositoryCount: 0 })
    );
    const absent = describeInstallationReach(
      installation({ repositoryCount: undefined })
    );
    assert.equal(zero, absent);
    assert.doesNotMatch(zero, /\b0\b/);
    assert.match(zero, /no/i);
  });
});

describe('installationForAccount', () => {
  it('finds the account whatever case the URL used', () => {
    // GitHub compares account names without case, so a diff at /Acme/... is the
    // same account as an installation on `acme`.
    const list = [installation({ account: 'acme' })];
    assert.equal(installationForAccount(list, 'Acme')?.account, 'acme');
    assert.equal(installationForAccount(list, 'ACME')?.account, 'acme');
  });

  it('answers nothing for an account with no installation', () => {
    assert.equal(
      installationForAccount([installation()], 'somebody-else'),
      undefined
    );
    assert.equal(installationForAccount([], 'acme'), undefined);
  });
});

describe('reachesAnyRepository', () => {
  it('separates an installation that can read something from one that cannot', () => {
    assert.equal(
      reachesAnyRepository(installation({ allRepositories: true })),
      true
    );
    assert.equal(
      reachesAnyRepository(installation({ repositoryCount: 1 })),
      true
    );
    assert.equal(
      reachesAnyRepository(installation({ repositoryCount: 0 })),
      false
    );
  });
});
