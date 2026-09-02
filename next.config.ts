import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next does not trace a computed path like `gw${n}.json` from a route
  // handler, so force the committed forecast data into the /api/live
  // serverless bundle (KTD5).
  outputFileTracingIncludes: {
    "/api/live": ["data/forecast/**/*"],
  },
};

export default nextConfig;
