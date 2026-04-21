import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    '@nivo/sankey',
    '@nivo/core',
    '@nivo/colors',
    '@nivo/legends',
    '@nivo/text',
    '@nivo/theming',
    '@nivo/tooltip',
  ],
};

export default nextConfig;
