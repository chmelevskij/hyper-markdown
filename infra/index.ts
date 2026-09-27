/**
 * Infrastructure for hyper-markdown's GitHub pull-request integration.
 *
 *  1. A GitHub App (registered through the manifest flow, see githubApp.ts).
 *     The desktop app signs users in with the *device flow* against this app's
 *     client id and then reads / writes PR review comments on their behalf.
 *  2. The client id published to the hyper-markdown repository as an Actions
 *     variable, so the release workflow can bake it into the build
 *     (`VITE_GITHUB_CLIENT_ID`). This is the @pulumi/github provider, i.e. the
 *     bridged integrations/github Terraform provider.
 *
 * Auth for step 2: GITHUB_TOKEN in the environment (`gh auth token` works).
 */
import * as pulumi from "@pulumi/pulumi";
import * as github from "@pulumi/github";
import { GitHubApp } from "./githubApp";

const cfg = new pulumi.Config();
const repoOwner = cfg.require("repoOwner");
const repoName = cfg.require("repoName");
const appName = cfg.require("appName");
const organization = cfg.get("organization") || undefined;

const repoUrl = `https://github.com/${repoOwner}/${repoName}`;

const app = new GitHubApp("hyper-markdown", {
  organization,
  manifest: {
    name: appName,
    url: repoUrl,
    description:
      "Review Markdown from pull requests in hyper-markdown: pull review threads onto the rendered document and push your comments back as a review.",
    // Public so anyone can install it on the repositories they review.
    public: true,
    default_permissions: {
      // Read + write review comments on pull requests.
      pull_requests: "write",
      // Read the document at the PR's head commit to anchor comments.
      contents: "read",
      metadata: "read",
    },
    // No webhooks: the desktop app polls on demand.
    request_oauth_on_install: false,
  },
});

const provider = new github.Provider("github", { owner: repoOwner });

// The release workflow reads this into VITE_GITHUB_CLIENT_ID at build time.
new github.ActionsVariable(
  "client-id",
  {
    repository: repoName,
    variableName: "HMD_GITHUB_CLIENT_ID",
    value: app.clientId,
  },
  { provider },
);

// Handy for the README / install link.
new github.ActionsVariable(
  "app-slug",
  {
    repository: repoName,
    variableName: "HMD_GITHUB_APP_SLUG",
    value: app.slug,
  },
  { provider },
);

export const appId = app.appId;
export const appSlug = app.slug;
export const clientId = app.clientId;
export const settingsUrl = app.settingsUrl;
export const installUrl = app.installUrl;
export const nextSteps = pulumi.interpolate`1) Enable Device Flow: ${app.settingsUrl}  2) Install the app on repositories you review: ${app.installUrl}  3) Put VITE_GITHUB_CLIENT_ID=${app.clientId} in .env.local for local builds.`;
