import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Standalone output drastically reduces final Docker image size.
  output: "standalone",

  // Reserved for future external image hosts (S3 / Cloudinary).
  images: {
    remotePatterns: [],
  },
};

export default withNextIntl(nextConfig);
