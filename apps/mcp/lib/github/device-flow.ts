// GitHub Device Flow proxy + at-rest token encryption.
//
// Calls 3 GitHub endpoints:
//   1. POST /login/device/code      → start
//   2. POST /login/oauth/access_token → poll
//   3. GET /user                     → fetch handle (after auth success)
//
// Plus AES-256-GCM helpers for encrypting the access_token before storing
// it in agent_accounts.github_oauth_token_encrypted.
//
// Docs: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const GH_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GH_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GH_USER_URL = "https://api.github.com/user";
const SCOPE = "read:user user:email";

// --- Device flow ---------------------------------------------------------

export interface DeviceFlowStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type PollResult =
  | { kind: "ok"; access_token: string }
  | { kind: "pending" }
  | { kind: "error"; error: string };

function clientId(): string {
  const id = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!id) throw new Error("GITHUB_OAUTH_CLIENT_ID must be set");
  return id;
}

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  const res = await fetch(GH_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId(),
      scope: SCOPE,
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub /login/device/code returned ${res.status}`);
  }
  const json = await res.json();
  return json as DeviceFlowStart;
}

export async function pollAccessToken(device_code: string): Promise<PollResult> {
  const res = await fetch(GH_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId(),
      device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  if (!res.ok) {
    return { kind: "error", error: `http_${res.status}` };
  }
  const json = await res.json();
  if (typeof json.access_token === "string") {
    return { kind: "ok", access_token: json.access_token };
  }
  if (json.error === "authorization_pending" || json.error === "slow_down") {
    return { kind: "pending" };
  }
  return { kind: "error", error: typeof json.error === "string" ? json.error : "unknown" };
}

export async function fetchUserHandle(access_token: string): Promise<string> {
  const res = await fetch(GH_USER_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${access_token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub /user returned ${res.status}`);
  }
  const json = await res.json();
  if (typeof json.login !== "string") {
    throw new Error("GitHub /user response missing login");
  }
  return json.login;
}

// --- Token encryption (at-rest) ----------------------------------------

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function encryptionKey(): Buffer {
  const raw = process.env.MCP_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("MCP_TOKEN_ENCRYPTION_KEY must be set (32+ chars)");
  return createHash("sha256").update(raw).digest();
}

export function encryptAccessToken(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: iv | tag | ciphertext, base64 encoded.
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptAccessToken(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_LEN + TAG_LEN) throw new Error("ciphertext too short");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
