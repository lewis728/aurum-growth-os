/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // pg-native is an optional native addon for pg — exclude from bundle
    config.externals = [...(config.externals ?? []), 'pg-native'];
    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'prisma'],
  },
};
export default nextConfig;
