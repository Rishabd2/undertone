import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Moss ships a native Rust binding (js-binding.*.node). It cannot be bundled
   * into an ESM chunk, so it has to stay external and be required at runtime.
   */
  serverExternalPackages: ["@moss-dev/moss", "@moss-dev/moss-core"],

  /**
   * Externalising it is not enough on Vercel: output file tracing follows
   * imports, sees no static reference to the .node siblings, and leaves them
   * out of the lambda. The runtime then reports "Cannot find native binding".
   * moss-core picks its binary with existsSync at require time, so the files
   * have to be there even though nothing imports them by name.
   */
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/@moss-dev/moss-core/js-binding.linux-x64-gnu.node",
      "./node_modules/@moss-dev/moss-core-linux-x64-gnu/**",
    ],
  },

  /**
   * The other four platform binaries are 8 to 12 MB each and would blow the
   * lambda size limit for no reason. Only linux-x64-gnu can ever run here.
   */
  outputFileTracingExcludes: {
    "/**": [
      "./node_modules/@moss-dev/moss-core/js-binding.darwin-*.node",
      "./node_modules/@moss-dev/moss-core/js-binding.win32-*.node",
      "./node_modules/@moss-dev/moss-core/js-binding.linux-arm64-*.node",
    ],
  },

  /**
   * Pin the workspace root. There is a stray package-lock.json in the home
   * directory, and without this Next infers that as the root and traces the
   * wrong file set.
   */
  turbopack: {
    root: path.resolve("."),
  },

  async rewrites() {
    return [
      { source: "/vetra-demo", destination: "/vetra-demo/index.html" },
      { source: "/vetra-demo/", destination: "/vetra-demo/index.html" },
      { source: "/carevet-preview", destination: "/carevet-preview/index.html" },
      { source: "/carevet-preview/", destination: "/carevet-preview/index.html" },
    ];
  },
};

export default nextConfig;
