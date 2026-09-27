import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Keep `next dev` and `next build` out of each other's output directory.
  // Sharing `.next` means running a production build while a dev server is up
  // deletes the chunks that server is still serving, and the running app dies
  // with "__webpack_modules__[moduleId] is not a function".
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  // Pin tracing to this workspace; an unrelated lockfile in $HOME otherwise wins.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  // The core engines ship as TypeScript source so the web app, a future React
  // Native app and the Node test runner all consume exactly the same code.
  //
  // Its internal imports are extension-less on purpose. They used to carry `.js`
  // (correct for Node's ESM resolver), which forced a `resolve.extensionAlias`
  // shim here to map them back to `.ts` — and that shim was where hot reloads of
  // core corrupted the module graph and killed the dev server with
  // "__webpack_modules__[moduleId] is not a function".
  //
  // Dev runs on webpack, not Turbopack: Turbopack in Next 15.5 fails this app
  // with "can't infer type of chunk from URL app-pages-internals" and renders a
  // blank page. Worth retrying on a later Next.
  transpilePackages: ["@fretlight/core"],
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default config;
