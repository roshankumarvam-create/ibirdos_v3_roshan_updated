import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@ibirdos/types",
    "@ibirdos/permissions",
    "@ibirdos/config",
    "@ibirdos/ui",
  ],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
