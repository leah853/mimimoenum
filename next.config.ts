import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // HHAH Portal demo
      { source: "/hhahdemo", destination: "/hhahdemo/index.html" },
      { source: "/hhahdemo/login", destination: "/hhahdemo/login.html" },
      { source: "/hhahdemo/auth/mfa/enroll", destination: "/hhahdemo/auth/mfa/enroll.html" },
      { source: "/hhahdemo/auth/mfa/challenge", destination: "/hhahdemo/auth/mfa/challenge.html" },
      { source: "/hhahdemo/sync", destination: "/hhahdemo/sync.html" },
      { source: "/hhahdemo/sync/upload", destination: "/hhahdemo/sync/upload.html" },
      { source: "/hhahdemo/sync/uploads", destination: "/hhahdemo/sync/uploads.html" },
      { source: "/hhahdemo/patients", destination: "/hhahdemo/patients.html" },
      { source: "/hhahdemo/patients/:id", destination: "/hhahdemo/patients/:id.html" },
      { source: "/hhahdemo/care-docs/signature-required", destination: "/hhahdemo/care-docs/signature-required.html" },
      { source: "/hhahdemo/care-docs/other", destination: "/hhahdemo/care-docs/other.html" },
      { source: "/hhahdemo/flags", destination: "/hhahdemo/flags.html" },
      { source: "/hhahdemo/communication", destination: "/hhahdemo/communication.html" },
      { source: "/hhahdemo/communication/new", destination: "/hhahdemo/communication/new.html" },
      { source: "/hhahdemo/notifications", destination: "/hhahdemo/notifications.html" },
      { source: "/hhahdemo/profile", destination: "/hhahdemo/profile.html" },
      { source: "/hhahdemo/settings", destination: "/hhahdemo/settings.html" },
      { source: "/hhahdemo/admin/baa", destination: "/hhahdemo/admin/baa.html" },
      { source: "/hhahdemo/admin/audit", destination: "/hhahdemo/admin/audit.html" },
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
