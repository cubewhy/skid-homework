import {dirname, resolve} from "path";
import {fileURLToPath} from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appTarget = process.env.NEXT_PUBLIC_APP_TARGET ?? "web";
const platformAliases = {
  web: "./src/platform/index.ts",
  "tauri-desktop": "./src-tauri/frontend/desktop/platform.tsx",
  "tauri-android": "./src-tauri/frontend/android/platform.ts",
};
const webpackPlatformAliases = Object.fromEntries(
  Object.entries(platformAliases).map(([target, path]) => [
    target,
    resolve(__dirname, path),
  ]),
);

if (!Object.hasOwn(platformAliases, appTarget)) {
  throw new Error(
    `Invalid NEXT_PUBLIC_APP_TARGET "${appTarget}". Expected web, tauri-desktop, or tauri-android.`,
  );
}

/** @type {import('next').NextConfig} */
const isTauri = process.env.TAURI_BUILD === "true";

const nextConfig = {
  output: isTauri ? "export" : "standalone",
  // Disable Next.js Image Optimization for Tauri SSG (requires a server)
  ...(isTauri && { images: { unoptimized: true } }),
  // The project runs an explicit `tsc --noEmit` step before `next build`.
  // Keeping Next's own worker-based typecheck enabled currently fails on
  // Windows in this repo with `spawn EPERM`, so builds skip the duplicate pass.
  typescript: {
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },

  turbopack: {
    // Explicitly set the project root to prevent Turbopack from inferring
    // a wrong workspace root from lockfiles outside the project directory
    root: __dirname,
    resolveAlias: {
      "@/platform": platformAliases[appTarget],
    },
    rules: {
      "*.md": {
        loaders: ["raw-loader"],
        as: "*.js",
      },
    },
  },

  webpack(config) {
    config.module.rules.push({
      test: /\.md$/,
      type: "asset/source",
    });
    config.resolve.alias = {
      ...config.resolve.alias,
      "@/platform": webpackPlatformAliases[appTarget],
    };
    return config;
  },
};

export default nextConfig;

