//! GitHub integration: device-flow sign-in, token storage in the OS keychain,
//! and an authenticated request proxy for the webview.
//!
//! The token never enters the webview. JavaScript asks for `github_request`
//! with a path and body; this module attaches the bearer token and returns the
//! status + JSON body. The device-flow endpoints live on github.com (not the
//! API host) and send no CORS headers, so they must be called from here anyway.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const KEYRING_SERVICE: &str = "hyper-markdown";
const KEYRING_USER: &str = "github-token";
const API: &str = "https://api.github.com";
const USER_AGENT: &str = concat!("hyper-markdown/", env!("CARGO_PKG_VERSION"));

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

fn load_token() -> Option<String> {
    entry().ok()?.get_password().ok()
}

fn store_token(token: &str) -> Result<(), String> {
    entry()?.set_password(token).map_err(|e| format!("Keychain write failed: {e}"))
}

#[derive(Serialize)]
pub struct AuthStatus {
    pub login: String,
    pub avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct User {
    login: String,
    avatar_url: Option<String>,
}

async fn whoami(token: &str) -> Result<AuthStatus, String> {
    let res = client()?
        .get(format!("{API}/user"))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("GitHub rejected the token (HTTP {})", res.status()));
    }
    let u: User = res.json().await.map_err(|e| e.to_string())?;
    Ok(AuthStatus { login: u.login, avatar_url: u.avatar_url })
}

/// Who is signed in, if the stored token still works. `None` when signed out.
#[tauri::command]
pub async fn github_auth_status() -> Result<Option<AuthStatus>, String> {
    let Some(token) = load_token() else { return Ok(None) };
    match whoami(&token).await {
        Ok(s) => Ok(Some(s)),
        // A revoked token is the same as being signed out; network errors are not.
        Err(e) if e.contains("HTTP 401") => Ok(None),
        Err(e) => Err(e),
    }
}

/// Store a token the user pasted (fine-grained PAT or a classic one with `repo`).
#[tauri::command]
pub async fn github_set_token(token: String) -> Result<AuthStatus, String> {
    let token = token.trim().to_string();
    let status = whoami(&token).await?;
    store_token(&token)?;
    Ok(status)
}

#[tauri::command]
pub fn github_logout() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// Step 1 of the device flow: ask GitHub for a user code to show the person.
#[tauri::command]
pub async fn github_device_start(client_id: String) -> Result<DeviceCode, String> {
    let res = client()?
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", client_id.as_str())])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Device flow start failed (HTTP {})", res.status()));
    }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = body.get("error").and_then(|e| e.as_str()) {
        let desc = body.get("error_description").and_then(|d| d.as_str()).unwrap_or("");
        return Err(format!("{err}: {desc}"));
    }
    serde_json::from_value(body).map_err(|e| format!("Unexpected device-code response: {e}"))
}

/// Step 2: poll until the person has approved (or the code expires). Stores the
/// token in the keychain and returns who signed in.
#[tauri::command]
pub async fn github_device_poll(client_id: String, code: DeviceCode) -> Result<AuthStatus, String> {
    let http = client()?;
    let deadline = Instant::now() + Duration::from_secs(code.expires_in);
    let mut interval = code.interval.max(5);
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if Instant::now() > deadline {
            return Err("The sign-in code expired — start again.".into());
        }
        let res = http
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id.as_str()),
                ("device_code", code.device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        if let Some(token) = body.get("access_token").and_then(|t| t.as_str()) {
            let status = whoami(token).await?;
            store_token(token)?;
            return Ok(status);
        }
        match body.get("error").and_then(|e| e.as_str()) {
            Some("authorization_pending") => continue,
            Some("slow_down") => interval += 5,
            Some("expired_token") => return Err("The sign-in code expired — start again.".into()),
            Some("access_denied") => return Err("Sign-in was cancelled on GitHub.".into()),
            Some(other) => {
                let desc = body.get("error_description").and_then(|d| d.as_str()).unwrap_or("");
                return Err(format!("{other}: {desc}"));
            }
            None => return Err("Unexpected response while waiting for approval.".into()),
        }
    }
}

#[derive(Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

/// Authenticated request against api.github.com (or an absolute URL). The
/// body is returned as JSON when it parses, else as a string.
#[tauri::command]
pub async fn github_request(
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> Result<ApiResponse, String> {
    let token = load_token().ok_or("Not signed in to GitHub")?;
    let url = if path.starts_with("http") { path } else { format!("{API}{path}") };
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client()?
        .request(method, url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    let body = serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text));
    Ok(ApiResponse { status, body })
}

// ---------------------------------------------------------------------------
// Repository detection — enough of git's on-disk layout to find the remote
// and branch for a document without shelling out or linking libgit2.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct RepoInfo {
    pub root: String,
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub branch: Option<String>,
    /// Document path relative to the repository root, `/`-separated.
    pub rel_path: String,
}

/// Locate `<root>/.git` (a directory, or a file pointing at a worktree gitdir).
/// Returns (worktree root, gitdir, commondir).
fn find_git(start: &Path) -> Option<(PathBuf, PathBuf, PathBuf)> {
    for root in start.ancestors() {
        let dot = root.join(".git");
        if dot.is_dir() {
            return Some((root.to_path_buf(), dot.clone(), dot));
        }
        if dot.is_file() {
            let text = std::fs::read_to_string(&dot).ok()?;
            let target = text.trim().strip_prefix("gitdir:")?.trim();
            let gitdir = root.join(target);
            let gitdir = std::fs::canonicalize(&gitdir).unwrap_or(gitdir);
            let common = std::fs::read_to_string(gitdir.join("commondir"))
                .ok()
                .map(|c| gitdir.join(c.trim()))
                .map(|c| std::fs::canonicalize(&c).unwrap_or(c))
                .unwrap_or_else(|| gitdir.clone());
            return Some((root.to_path_buf(), gitdir, common));
        }
    }
    None
}

/// `[remote "origin"] url = …` from a git config file.
fn origin_url(config: &str) -> Option<String> {
    let mut in_origin = false;
    for line in config.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_origin = line == "[remote \"origin\"]";
            continue;
        }
        if in_origin {
            if let Some(v) = line.strip_prefix("url") {
                let v = v.trim_start();
                if let Some(v) = v.strip_prefix('=') {
                    return Some(v.trim().to_string());
                }
            }
        }
    }
    None
}

/// host/owner/repo from ssh (`git@h:o/r.git`), ssh-url and https remotes.
fn parse_remote(url: &str) -> Option<(String, String, String)> {
    let url = url.trim().trim_end_matches('/');
    let url = url.strip_suffix(".git").unwrap_or(url);
    let rest = if let Some(r) = url.strip_prefix("ssh://") {
        r
    } else if let Some(r) = url.strip_prefix("https://") {
        r
    } else if let Some(r) = url.strip_prefix("http://") {
        r
    } else if let Some(r) = url.strip_prefix("git://") {
        r
    } else if url.contains(':') && !url.contains("://") {
        // scp-like: [user@]host:owner/repo
        let (host, path) = url.split_once(':')?;
        let host = host.rsplit('@').next()?.to_string();
        let (owner, repo) = path.trim_start_matches('/').split_once('/')?;
        return Some((host, owner.to_string(), repo.to_string()));
    } else {
        return None;
    };
    let (hostpart, path) = rest.split_once('/')?;
    let host = hostpart.rsplit('@').next()?.to_string();
    let mut segs = path.split('/').filter(|s| !s.is_empty());
    let owner = segs.next()?.to_string();
    let repo = segs.next()?.to_string();
    Some((host, owner, repo))
}

/// Which repository a document lives in, if any.
#[tauri::command]
pub fn git_repo_info(path: String) -> Option<RepoInfo> {
    let file = PathBuf::from(&path);
    let (root, gitdir, common) = find_git(file.parent()?)?;
    let config = std::fs::read_to_string(common.join("config")).ok()?;
    let (host, owner, repo) = parse_remote(&origin_url(&config)?)?;
    let branch = std::fs::read_to_string(gitdir.join("HEAD"))
        .ok()
        .and_then(|h| h.trim().strip_prefix("ref: refs/heads/").map(|b| b.to_string()));
    let canon_root = std::fs::canonicalize(&root).unwrap_or(root.clone());
    let canon_file = std::fs::canonicalize(&file).unwrap_or(file.clone());
    let rel = canon_file
        .strip_prefix(&canon_root)
        .ok()?
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/");
    Some(RepoInfo {
        root: root.to_string_lossy().to_string(),
        host,
        owner,
        repo,
        branch,
        rel_path: rel,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_remotes() {
        for u in [
            "git@github.com:chmelevskij/hyper-markdown.git",
            "ssh://git@github.com/chmelevskij/hyper-markdown.git",
            "https://github.com/chmelevskij/hyper-markdown",
            "https://user@github.com/chmelevskij/hyper-markdown.git/",
        ] {
            let (h, o, r) = parse_remote(u).unwrap();
            assert_eq!((h.as_str(), o.as_str(), r.as_str()), ("github.com", "chmelevskij", "hyper-markdown"), "{u}");
        }
    }

    #[test]
    fn reads_origin() {
        let cfg = "[core]\n\tbare = false\n[remote \"upstream\"]\n\turl = x\n[remote \"origin\"]\n\turl = git@github.com:a/b.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n";
        assert_eq!(origin_url(cfg).as_deref(), Some("git@github.com:a/b.git"));
    }
}
