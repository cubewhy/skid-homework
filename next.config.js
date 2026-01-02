/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",

  turbopack: {
    rules: {
      "*.md": {
        loaders: ["raw-loader"],
        as: "*.js",
      },
    },
  },
};

export default nextConfig;
