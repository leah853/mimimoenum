import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      // beforeFiles runs BEFORE the public/ filesystem check — needed for
      // directory-index URLs like /hhahdemo → /hhahdemo/index.html.
      beforeFiles: [
        {
          source: "/hhahdemo",
          destination: "/hhahdemo/index.html",
        },
        {
          source: "/hhahdemo/:path*",
          destination: "/hhahdemo/:path*/index.html",
        },
      ],
      afterFiles: [
        {
          source: "/orchestrator",
          destination: "/orchestrator.html",
        },
        // Market Analysis SPA — serve index.html for any unmatched path under
        // /unittest_marketanalysis so React Router can handle client-side routes.
        // Static files (assets, favicon.svg) are served directly from public/.
        {
          source: "/unittest_marketanalysis",
          destination: "/unittest_marketanalysis/index.html",
        },
        {
          source: "/unittest_marketanalysis/login",
          destination: "/unittest_marketanalysis/index.html",
        },
        {
          source: "/unittest_marketanalysis/tasks/:path*",
          destination: "/unittest_marketanalysis/index.html",
        },
        {
          source: "/unittest_marketanalysis/workflows/:path*",
          destination: "/unittest_marketanalysis/index.html",
        },
        {
          source: "/unittest_marketanalysis/entities/:path*",
          destination: "/unittest_marketanalysis/index.html",
        },
        {
          source: "/unittest_marketanalysis/activity",
          destination: "/unittest_marketanalysis/index.html",
        },
      ],
      fallback: [],
    };
  },
};

export default nextConfig;
