/**
 * Public surface of the sandbox subsystem.
 *
 * GHB-70 ships only the lifecycle primitives (spawn / wait / destroy).
 * GHB-71 will export the test-runner detector through this same file,
 * and GHB-72 will export the high-level `runSandboxedTests()` that
 * stitches it all together. Keeping a single barrel keeps the
 * submission handler import surface stable.
 */

export {
  spawnSandbox,
  waitForSandboxExit,
  destroySandbox,
  SandboxDisabledError,
} from "./fly.js";

export type {
  SandboxConfig,
  SandboxHandle,
  SandboxResult,
  SpawnOptions,
} from "./types.js";
