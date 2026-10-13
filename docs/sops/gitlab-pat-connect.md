# SOP: connect to GitLab with a personal access token

The way in when the instance has no OAuth application configured — which is
every instance by default.

## Create the token

On the GitLab instance: **Preferences → Access tokens** (ghdiff links you there
from the connect dialog). Create a token with the **`api`** scope. Any valid
expiry works; the token never refreshes, so it is good until that date.

## Connect

Open the dialog from:

- the **Connect GitLab** button on a failure panel (a private or rate-limited
  GitLab diff), or
- the account panel (your avatar, top right).

Pick the host from the configured list — the diff you were reading preselects it
— and paste the token. ghdiff proves it against the instance before sealing it —
a bad token is answered with the instance's own sentence, not discovered later
diff by diff. The page reloads, and the diff that would not load renders.

## Where the token lives

In the same sealed `httpOnly` session cookie as an OAuth sign-in. Never in
browser storage, never on the server's disk, and it leaves the browser only as
the instance's credential on requests you make.

## Disconnect or rotate

- Sign out ends every connection (GitHub and all GitLab hosts) and revokes OAuth
  grants. A PAT is not revoked — the cookie drop is its sign-out; revoke the
  token itself on the instance's token page when you mean it.
- A token that expires or is revoked starts answering 401s. Connect again with a
  new one — it overwrites the grant for that host.
