import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Keep Turbopack rooted here — a parent ~/package-lock.json otherwise
  // makes Next treat the home directory as the project root.
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
