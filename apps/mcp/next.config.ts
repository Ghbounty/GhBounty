import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Same reason as frontend: workspace packages with NodeNext-style imports
  // need transpilation through Next/SWC.
  transpilePackages: ["@ghbounty/sdk", "@ghbounty/shared", "@ghbounty/db"],

  reactStrictMode: true,
};

export default nextConfig;
