/**
 * A GitHub App as a Pulumi resource.
 *
 * GitHub has no REST API for creating apps (and the Terraform provider that
 * @pulumi/github bridges has no resource for it either). The only automatable
 * path is the **manifest flow**: a browser form POSTs a JSON manifest to
 * github.com, GitHub redirects back with a one-time code, and that code is
 * converted into the app — id, client id/secret, private key — through
 * `POST /app-manifests/{code}/conversions` (no auth needed).
 *
 * This dynamic provider drives that flow from inside `pulumi up`: it serves a
 * self-submitting form on localhost, opens it in the browser, waits for the
 * redirect, converts the code and stores everything as (secret) outputs.
 *
 * What cannot be automated, and is left as documented manual steps:
 *  - enabling *Device Flow* on the app (no manifest field, no API);
 *  - deleting the app (no API) — `pulumi destroy` only prints where to do it.
 */
import * as pulumi from "@pulumi/pulumi";
import * as http from "http";
import * as crypto from "crypto";
import { spawn } from "child_process";
import { AddressInfo } from "net";

export interface AppManifest {
  name: string;
  url: string;
  description?: string;
  public?: boolean;
  default_permissions?: Record<string, "read" | "write" | "admin">;
  default_events?: string[];
  callback_urls?: string[];
  setup_url?: string;
  request_oauth_on_install?: boolean;
  setup_on_update?: boolean;
  hook_attributes?: { url: string; active?: boolean };
}

export interface GitHubAppArgs {
  manifest: pulumi.Input<AppManifest>;
  /** Register under an organisation instead of the personal account running the flow. */
  organization?: pulumi.Input<string | undefined>;
  /** Seconds to wait for the browser round-trip (default 600). */
  timeoutSeconds?: pulumi.Input<number>;
}

interface Inputs {
  manifest: AppManifest;
  organization?: string;
  timeoutSeconds?: number;
}

interface Outputs extends Inputs {
  appId: number;
  nodeId: string;
  slug: string;
  htmlUrl: string;
  clientId: string;
  clientSecret: string;
  pem: string;
  webhookSecret: string;
  settingsUrl: string;
  installUrl: string;
}

const log = (msg: string) => {
  // pulumi.log routes through the engine when available; stderr is the fallback
  // for the odd context where it is not (e.g. unit tests).
  pulumi.log.info(msg).catch(() => console.error(msg));
};

function openInBrowser(url: string) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* the URL is printed anyway */
  }
}

const formPage = (action: string, manifest: AppManifest) => `<!doctype html>
<meta charset="utf-8"><title>Register hyper-markdown GitHub App</title>
<body style="font: 15px system-ui; padding: 2rem; max-width: 40rem">
<h1>Registering “${manifest.name}”…</h1>
<p>You will be taken to GitHub to confirm the app. If nothing happens, press the button.</p>
<form id="f" method="post" action="${action}">
  <textarea name="manifest" hidden>${JSON.stringify(manifest)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</textarea>
  <button type="submit">Continue to GitHub</button>
</form>
<script>document.getElementById("f").submit()</script>`;

/** Run the browser round-trip and return GitHub's one-time conversion code. */
async function obtainCode(inputs: Inputs): Promise<string> {
  const state = crypto.randomBytes(16).toString("hex");
  const timeoutMs = (inputs.timeoutSeconds ?? 600) * 1000;

  return new Promise<string>((resolve, reject) => {
    let port = 0;
    let timer: NodeJS.Timeout | undefined;
    let server: http.Server | undefined;
    const finish = (err: Error | null, code?: string) => {
      if (timer) clearTimeout(timer);
      server?.close();
      if (err) reject(err);
      else resolve(code!);
    };
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname === "/") {
        const base = inputs.organization
          ? `https://github.com/organizations/${inputs.organization}/settings/apps/new`
          : "https://github.com/settings/apps/new";
        const manifest: AppManifest = {
          ...inputs.manifest,
          redirect_url: `http://127.0.0.1:${port}/callback`,
        } as AppManifest & { redirect_url: string };
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(formPage(`${base}?state=${state}`, manifest));
        return;
      }
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const echoed = url.searchParams.get("state");
        if (!code || echoed !== state) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("Missing code or state mismatch — re-run pulumi up.");
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<body style="font: 15px system-ui; padding: 2rem"><h1>Done</h1><p>You can close this tab; pulumi is finishing the registration.</p>`,
        );
        finish(null, code);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    timer = setTimeout(() => {
      finish(new Error(`Timed out after ${timeoutMs / 1000}s waiting for the GitHub App manifest redirect.`));
    }, timeoutMs);

    server.listen(0, "127.0.0.1", () => {
      port = (server!.address() as AddressInfo).port;
      const url = `http://127.0.0.1:${port}/`;
      log(`Open ${url} to register the GitHub App (opening your browser…)`);
      openInBrowser(url);
    });
    server.on("error", (e) => finish(e));
  });
}

const settingsUrlFor = (org: string | undefined, slug: string) =>
  org ? `https://github.com/organizations/${org}/settings/apps/${slug}` : `https://github.com/settings/apps/${slug}`;

const provider: pulumi.dynamic.ResourceProvider<Inputs, Outputs> = {
  async create(inputs) {
    const code = await obtainCode(inputs);
    const res = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", "user-agent": "hyper-markdown-infra" },
    });
    if (!res.ok) {
      throw new Error(`Manifest conversion failed: HTTP ${res.status} ${await res.text()}`);
    }
    const app = (await res.json()) as {
      id: number;
      node_id: string;
      slug: string;
      html_url: string;
      client_id: string;
      client_secret: string;
      pem: string;
      webhook_secret: string | null;
    };
    log(`Created GitHub App “${inputs.manifest.name}” (id ${app.id}, slug ${app.slug}).`);
    log(`Enable Device Flow at ${settingsUrlFor(inputs.organization, app.slug)} — this cannot be automated.`);
    return {
      id: String(app.id),
      outs: {
        ...inputs,
        appId: app.id,
        nodeId: app.node_id,
        slug: app.slug,
        htmlUrl: app.html_url,
        clientId: app.client_id,
        clientSecret: app.client_secret,
        pem: app.pem,
        webhookSecret: app.webhook_secret ?? "",
        settingsUrl: settingsUrlFor(inputs.organization, app.slug),
        installUrl: `https://github.com/apps/${app.slug}/installations/new`,
      },
    };
  },

  async diff(_id, olds, news) {
    // There is no API to edit an app, so any manifest change means a new app.
    // GitHub rejects a duplicate name, so this is safe: the old app stays put
    // until you delete it by hand, and the run fails loudly instead of silently
    // drifting.
    const changed =
      JSON.stringify(olds.manifest) !== JSON.stringify(news.manifest) ||
      (olds.organization ?? "") !== (news.organization ?? "");
    return { changes: changed, replaces: changed ? ["manifest"] : [], deleteBeforeReplace: true };
  },

  async delete(id, props) {
    log(
      `GitHub Apps cannot be deleted through the API. Remove app ${id} manually at ${props.settingsUrl}/advanced (this state entry is dropped now).`,
    );
  },

  async read(id, props) {
    // Nothing to refresh from: the conversion response is the only time GitHub
    // hands out the client secret and private key.
    return { id, props };
  },
};

export class GitHubApp extends pulumi.dynamic.Resource {
  declare public readonly appId: pulumi.Output<number>;
  declare public readonly nodeId: pulumi.Output<string>;
  declare public readonly slug: pulumi.Output<string>;
  declare public readonly htmlUrl: pulumi.Output<string>;
  declare public readonly clientId: pulumi.Output<string>;
  declare public readonly clientSecret: pulumi.Output<string>;
  declare public readonly pem: pulumi.Output<string>;
  declare public readonly webhookSecret: pulumi.Output<string>;
  declare public readonly settingsUrl: pulumi.Output<string>;
  declare public readonly installUrl: pulumi.Output<string>;

  constructor(name: string, args: GitHubAppArgs, opts?: pulumi.CustomResourceOptions) {
    super(
      provider,
      name,
      {
        ...args,
        appId: undefined,
        nodeId: undefined,
        slug: undefined,
        htmlUrl: undefined,
        clientId: undefined,
        clientSecret: undefined,
        pem: undefined,
        webhookSecret: undefined,
        settingsUrl: undefined,
        installUrl: undefined,
      },
      { ...opts, additionalSecretOutputs: ["clientSecret", "pem", "webhookSecret"] },
    );
  }
}
