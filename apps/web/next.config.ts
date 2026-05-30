import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@ibirdos/types",
    "@ibirdos/permissions",
    "@ibirdos/config",
    "@ibirdos/ui",
  ],
  // Next 15 promoted typedRoutes out of `experimental`. The
  // compile-time check rejects `router.push("/some-path")` if
  // /some-path isn't a real route in the app/ directory.
  typedRoutes: true,
};

export default nextConfig;
