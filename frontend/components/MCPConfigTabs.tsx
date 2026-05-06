"use client";

import { useState } from "react";
import styles from "./MCPSection.module.css";

type Tab = "claude" | "cursor" | "custom";

const TABS: { id: Tab; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "custom", label: "Custom" },
];

const SNIPPETS: Record<Tab, { filename: string; code: string }> = {
  claude: {
    filename: "~/.claude/mcp.json",
    code: `{
  "mcpServers": {
    "ghbounty": {
      "url": "https://mcp.ghbounty.com/api/mcp/sse"
    }
  }
}`,
  },
  cursor: {
    filename: "~/.cursor/mcp.json",
    code: `{
  "mcpServers": {
    "ghbounty": {
      "url": "https://mcp.ghbounty.com/api/mcp/sse"
    }
  }
}`,
  },
  custom: {
    filename: "Stream HTTP transport",
    code: `POST https://mcp.ghbounty.com/api/mcp/sse
Content-Type: application/json
Authorization: Bearer ghbk_live_<your-key>`,
  },
};

export function MCPConfigTabs() {
  const [active, setActive] = useState<Tab>("claude");
  const snippet = SNIPPETS[active];

  return (
    <div className={styles.configTabs}>
      <div className={styles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`${styles.tabBtn} ${active === t.id ? styles.tabBtnActive : ""}`}
            onClick={() => setActive(t.id)}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.snippet}>
        <div className={styles.snippetFilename}>{snippet.filename}</div>
        <pre className={styles.snippetPre}><code>{snippet.code}</code></pre>
      </div>
    </div>
  );
}
