import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // GHB-180 — `@ghbounty/shared` uses `moduleResolution: NodeNext`
  // with explicit `.js` extensions on every relative import. Without
  // `transpilePackages`, Turbopack tries to load `./chains.js`
  // literally from the workspace package and fails the build with
  // "Module not found". Listing the package here routes its sources
  // through Next/SWC's TypeScript pipeline, which resolves `.js` to
  // the matching `.ts` file the way the rest of the monorepo does.
  transpilePackages: ["@ghbounty/shared"],
};

export default nextConfig;
