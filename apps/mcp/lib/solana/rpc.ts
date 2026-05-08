// @solana/kit RPC client. Reads SOLANA_RPC_URL from env (Helius mainnet
// for production, devnet for dev). Singleton for connection reuse.

import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  type Rpc,
  type SolanaRpcApi,
  type RpcSubscriptions,
  type SolanaRpcSubscriptionsApi,
} from "@solana/kit";

let _rpc: Rpc<SolanaRpcApi> | null = null;
let _subs: RpcSubscriptions<SolanaRpcSubscriptionsApi> | null = null;

export function solanaRpc(): Rpc<SolanaRpcApi> {
  if (_rpc) return _rpc;
  const url = process.env.SOLANA_RPC_URL;
  if (!url) {
    throw new Error("SOLANA_RPC_URL must be set in apps/mcp env");
  }
  _rpc = createSolanaRpc(url);
  return _rpc;
}

export function solanaRpcSubscriptions(): RpcSubscriptions<SolanaRpcSubscriptionsApi> {
  if (_subs) return _subs;
  const url = process.env.SOLANA_RPC_URL;
  if (!url) {
    throw new Error("SOLANA_RPC_URL must be set in apps/mcp env");
  }
  // ws:// URL is the http URL with the protocol swapped
  const wsUrl = url.replace(/^http/, "ws");
  _subs = createSolanaRpcSubscriptions(wsUrl);
  return _subs;
}
