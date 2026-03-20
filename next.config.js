import {dirname} from "path";
import {fileURLToPath} from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const isTauri = process.env.TAURI_BUILD === "true";

const nextConfig = {
  output: isTauri ? "export" : "standalone",
  // Disable Next.js Image Optimization for Tauri SSG (requires a server)
  ...(isTauri && { images: { unoptimized: true } }),
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
    rules: {
      "*.md": {
        loaders: ["raw-loader"],
        as: "*.js",
      },
    },
  },
};

export default nextConfig;

