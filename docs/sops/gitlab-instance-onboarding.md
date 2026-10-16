# SOP: onboard a GitLab instance (OAuth)

How to give a GitLab host the OAuth sign-in flow. A host without this works too
— reviewers then connect to it with personal access tokens (see
`gitlab-pat-connect.md`).

One deployment serves GitHub and any number of GitLab hosts. `GITLAB_HOSTS`
names them as a JSON array, read at runtime only — the client learns the list
with the page, from the root route's loader, so a change is a restart, never a
rebuild.

## 1. Register the OAuth application on the instance

On the GitLab instance, as an admin:

1. Go to **Admin → Applications** (or your user **Preferences → Applications**
   for a user-scoped one).
2. Create an application:
   - **Name**: `ghdiff`
   - **Redirect URI**: `<ghdiff-origin>/api/auth/callback` — the origin ghdiff
     is served from, e.g. `https://ghdiff.internal.corp` or
     `http://localhost:3000`. One application per origin; the callback derives
     from the request, so production and a laptop each need their own entry or
     their own app.
   - **Scopes**: `api` (diffs, comments, approvals).
3. Copy the **Application ID** and **Secret**.

## 2. Add the host to `GITLAB_HOSTS`

In `.dev.vars` (or the deployment's environment):

```sh
GITLAB_HOSTS=[{"host":"gitlab.corp.com","clientId":"…","clientSecret":"…"}]
```

- `host` is the instance's hostname, optional port included. It is one of any
  number this deployment serves: a review URL names it in the first segment —
  `/gitlab.corp.com:group/repo/-/merge_requests/1` — and a host not in the list
  is a 404 whose sentence names the ones that are.
- An entry without `clientId`/`clientSecret` is a PAT host: public projects read
  anonymously, and reviewers connect with a token.
- What throws on the first request is a typo: JSON that does not parse, a host
  that is not one, the same host twice, half an OAuth pair, or more than eight
  hosts (as many sign-ins as one session cookie holds) — a loud failure is what
  tells somebody so.

Restart after a change; nothing rebuilds. The list is parsed from the
environment on each request, so a restart picks the new value up and the next
page load learns it.

## 3. Verify

1. Open `http://localhost:3000/api/auth/start?forge=gitlab&host=gitlab.corp.com`
   — it should 302 to the instance's own authorize page. A 501 means the host is
   not in `GITLAB_HOSTS`, or its entry has no OAuth pair.
2. Complete the consent screen. You should land back on ghdiff connected.
3. Open a private merge request on the instance — it should render.

## Remove access

- Sign out in ghdiff (revokes the grant at the instance).
- Delete the application on the instance.
- Remove the host's entry from `GITLAB_HOSTS` and restart. Grants for the host
  are dropped on the next refresh attempt, and anonymous public reads stop with
  the host.
