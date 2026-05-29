/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ignore optional pg-native module that is not available in Vercel build
      config.externals = [...(config.externals || []), 'pg-native'];
    }
    return config;
  },
};
export default nextConfig;
