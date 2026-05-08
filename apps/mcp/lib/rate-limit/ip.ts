// Extract the client IP from a request, taking Vercel's headers into
// account. The MCP adapter passes a standard fetch Request, so we read
// from headers.

export function getClientIp(request: Request): string {
  // Vercel sets these in order of preference:
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // First entry in the comma-separated list is the original client.
    const first = forwarded.split(",")[0];
    return first ? first.trim() : "unknown";
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}
