import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Moss ships a native Rust binding (js-binding.*.node). It cannot be bundled
   * into an ESM chunk, so it has to stay external and be required at runtime.
   */
  serverExternalPackages: ["@moss-dev/moss", "@moss-dev/moss-core"],

  /**
   * Pin the workspace root. There is a stray package-lock.json in the home
   * directory, and without this Next infers that as the root and traces the
   * wrong file set.
   */
  turbopack: {
    root: path.resolve("."),
  },
};

export default nextConfig;
