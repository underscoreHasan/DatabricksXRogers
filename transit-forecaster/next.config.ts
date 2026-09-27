import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/",
        destination: "/waterfront/index.html",
        permanent: false,
      },
      {
        source: "/waterfront",
        destination: "/waterfront/index.html",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
