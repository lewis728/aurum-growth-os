/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // Stripe price IDs — fall back to the known test-mode price IDs if not set in Vercel
    STRIPE_PLATFORM_PRICE_ID: process.env.STRIPE_PLATFORM_PRICE_ID ?? 'price_1TcQDbGxWuTpPYnN7yeE9Tos',
    STRIPE_SEAT_PRICE_ID: process.env.STRIPE_SEAT_PRICE_ID ?? 'price_1TcQDdGxWuTpPYnNWQcHDETk',
    // Stripe publishable key — accept either NEXT_PUBLIC_ or VITE_ prefix
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
      process.env.VITE_STRIPE_PUBLISHABLE_KEY ??
      '',
  },
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
