// Calls the frontend's /api/gas-station/sponsor endpoint to submit a
// gas-station-sponsored transaction. The endpoint is shared with the
// frontend and has its own auth (Privy bearer for human users; we use
// a service-to-service shared secret for the MCP).
//
// FRONTEND FOLLOW-UP NEEDED: frontend/lib/gas-station-route-core.ts must
// be extended to accept a new auth path: requests with the
// `x-mcp-service-token` header where the value matches the
// GAS_STATION_SERVICE_TOKEN env var. Open a separate PR after this one
// merges.
//
// Returns either { tx_hash } or a structured error.

export interface SponsorResult {
  ok: boolean;
  tx_hash?: string;
  error?: { code: string; message: string };
}

function endpointUrl(): string {
  const url = process.env.GAS_STATION_SPONSOR_URL;
  if (!url) throw new Error("GAS_STATION_SPONSOR_URL must be set");
  return url;
}

function serviceToken(): string {
  const tok = process.env.GAS_STATION_SERVICE_TOKEN;
  if (!tok) throw new Error("GAS_STATION_SERVICE_TOKEN must be set");
  return tok;
}

export async function sponsorAndSubmit(signed_tx_b64: string): Promise<SponsorResult> {
  const res = await fetch(endpointUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-mcp-service-token": serviceToken(),
    },
    body: JSON.stringify({ signed_tx_b64, source: "mcp" }),
  });

  let json: { tx_hash?: string; error?: { code: string; message: string } };
  try {
    json = (await res.json()) as { tx_hash?: string; error?: { code: string; message: string } };
  } catch {
    return { ok: false, error: { code: "RpcError", message: `Gas station returned ${res.status} (non-JSON body)` } };
  }

  if (res.status === 200 && json.tx_hash) {
    return { ok: true, tx_hash: json.tx_hash };
  }
  if (json.error) {
    return { ok: false, error: json.error };
  }
  return { ok: false, error: { code: "RpcError", message: `Gas station returned ${res.status}` } };
}
