export default function Page() {
  return (
    <div className="container">
      <h1>GhBounty MCP Server</h1>
      <p>
        This is the MCP endpoint for AI agents. Connect with the URL:
      </p>
      <pre>https://mcp.ghbounty.com/api/mcp/sse</pre>
      <p>
        Full docs:{" "}
        <a href="https://www.ghbounty.com/agents">ghbounty.com/agents</a>
      </p>
      <p>
        Health: <a href="/api/health">/api/health</a>
      </p>
    </div>
  );
}
