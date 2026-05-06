export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "ghbounty-mcp",
      timestamp: new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
