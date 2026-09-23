# infra — the GitHub App behind hyper-markdown's PR sync

A [Pulumi](https://www.pulumi.com/) program (TypeScript) that provisions what the
desktop app needs to talk to GitHub:

| resource | what | how |
| --- | --- | --- |
| `GitHubApp` (`githubApp.ts`) | the GitHub App users sign in to | dynamic provider driving GitHub's **manifest flow** |
| `github.ActionsVariable` ×2 | `HMD_GITHUB_CLIENT_ID`, `HMD_GITHUB_APP_SLUG` on the repo | `@pulumi/github` — the bridged [integrations/github](https://registry.terraform.io/providers/integrations/github) Terraform provider |

## Why a dynamic provider

GitHub has no API to create apps, so neither Terraform nor Pulumi ship a resource for it.
The one automatable route is the manifest flow: a browser form POSTs the app manifest to
github.com, GitHub bounces back with a one-time code, and
`POST /app-manifests/{code}/conversions` turns that into the app — including its client
id, client secret and private key, which GitHub hands out only once. `githubApp.ts` runs
exactly that from inside `pulumi up`: it serves the form on `127.0.0.1`, opens your
browser, waits for the redirect, converts the code and keeps the results as (secret) stack
outputs.

## Running it

```bash
cd infra
pnpm install
pulumi stack select prod        # or: pulumi stack init prod
export GITHUB_TOKEN=$(gh auth token)   # for the Actions variables (repo admin)
pulumi up
```

`pulumi up` opens a browser tab. Confirm the app on GitHub (you'll be asked which account
owns it); the tab says *Done* and Pulumi finishes. Then two things that have no API:

1. **Enable Device Flow** — open the `settingsUrl` output, tick *Enable Device Flow*,
   save. Without this, sign-in in the app fails with `device_flow_disabled`.
2. **Install the app** on the repositories whose PRs you review (`installUrl` output).
   A GitHub App's user token only reaches repositories the app is installed on, so
   each org or user whose PRs you want to see needs one install. The app is public, so
   anyone can do that for their own repos.

Then put the client id where builds can see it:

- CI: already done — the `HMD_GITHUB_CLIENT_ID` Actions variable feeds
  `VITE_GITHUB_CLIENT_ID` in `.github/workflows/release.yml`.
- Locally: `VITE_GITHUB_CLIENT_ID=$(pulumi stack output clientId)` in `.env.local`.

## Config

| key | default | |
| --- | --- | --- |
| `repoOwner` | `chmelevskij` | owner of the repository that gets the Actions variables |
| `repoName` | `hyper-markdown` | that repository |
| `appName` | `hyper-markdown` | display name; must be unique on github.com |
| `organization` | _(empty)_ | register the app under an organisation instead of your account |

`Pulumi.prod.yaml` holds the `prod` stack's values.

## Caveats

- **Changing the manifest replaces the app.** There is no update API. `diff` reports a
  replacement; GitHub refuses a duplicate name, so the run fails rather than creating a
  second app silently. Delete the old app by hand first (`settingsUrl` → *Advanced*).
- **`pulumi destroy` cannot delete the app.** It drops the state entry and prints where
  to delete it manually.
- **The client secret and private key** are stored as secret outputs. The desktop app
  doesn't use them (device flow needs only the client id); they are there in case a
  server-side integration ever does.
