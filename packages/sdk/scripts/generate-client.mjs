// packages/sdk/scripts/generate-client.mjs
//
// Reads packages/sdk/src/idl.json and writes a type-safe @solana/kit-
// compatible client to packages/sdk/src/generated/.
//
// Run via: pnpm --filter @ghbounty/sdk codama:generate
//
// NOTE: API adaptation from plan:
//   - Plan used `renderJavaScriptVisitor` — actual export is `renderVisitor`
//     (from @codama/renderers-js@2.2.0, the default export and named export are both `renderVisitor`)
//   - `renderVisitor(packageFolder, opts)` takes the package root as its first
//     argument and appends opts.generatedFolder (default "src/generated") internally.
//     Passing `src/generated` directly would produce a double-nested path, so we
//     pass the SDK package root and let the renderer use the default sub-folder.

import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const __dirname = new URL(".", import.meta.url).pathname;
const idlPath = resolve(__dirname, "../src/idl.json");
// packageFolder = the SDK package root; renderVisitor appends "src/generated" automatically
const packageFolder = resolve(__dirname, "..");
const outDir = resolve(packageFolder, "src/generated");

const idl = JSON.parse(readFileSync(idlPath, "utf8"));
const node = rootNodeFromAnchor(idl);
const codama = createFromRoot(node);

// renderVisitor manages its own directory cleanup via deleteFolderBeforeRendering
await codama.accept(renderVisitor(packageFolder, { deleteFolderBeforeRendering: true }));
console.log(`✓ Codama client written to ${outDir}`);
