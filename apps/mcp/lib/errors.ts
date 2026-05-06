// Typed errors matching the spec's error model. Each tool returns these
// to the MCP transport, which formats them as JSON-RPC errors.

export type McpErrorCode =
  | "BlockhashExpired"
  | "WalletInsufficientFunds"
  | "InvalidSignature"
  | "WrongSigner"
  | "TxTampered"
  | "ProgramError"
  | "RateLimited"
  | "Unauthorized"
  | "Forbidden"
  | "NotFound"
  | "Conflict"
  | "RpcError"
  | "InternalError"
  | "InvalidInput";

export interface McpError {
  code: McpErrorCode;
  message: string;
  details?: unknown;
}

export function mcpError(code: McpErrorCode, message: string, details?: unknown): McpError {
  return { code, message, details };
}
