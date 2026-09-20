import type { NextConfig } from "next";

const isProduction = process.env.VERCEL_ENV === "production";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@jeval/core", "@jeval/provider-jev"],
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    // Preview and development deployments must not be indexed.
    const robots = isProduction ? [] : [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [{ source: "/(.*)", headers: [...security, ...robots] }];
  },
};

export default nextConfig;
