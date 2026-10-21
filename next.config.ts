import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/orders/*/download/*": ["./assets/downloads/unlock-all-demo.txt"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  turbopack: { root: process.cwd() },
};
export default createNextIntlPlugin()(config);
