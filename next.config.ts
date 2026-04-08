import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/orchestrator",
        destination: "/orchestrator/index.html",
      },
    ];
  },
};

export default nextConfig;
