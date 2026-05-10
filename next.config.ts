import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // /hhahdemo → public/hhahdemo/index.html
      {
        source: "/hhahdemo",
        destination: "/hhahdemo/index.html",
      },
      // /hhahdemo/<anything> → public/hhahdemo/<anything>.html
      // Skip when the path already ends in .html or is an asset, to avoid recursion.
      {
        source: "/hhahdemo/:path((?!.*\\.html$).+)",
        destination: "/hhahdemo/:path.html",
      },
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
    ];
  },
};

export default nextConfig;
