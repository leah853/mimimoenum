import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/orchestrator",
        destination: "/orchestrator.html",
      },
    ];
  },
};

export default nextConfig;
