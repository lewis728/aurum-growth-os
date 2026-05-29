import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { nextRuntime, webpack }) => {
    config.externals = [...(config.externals ?? []), 'pg-native'];

    // Replace node:async_hooks with a polyfill for the Edge runtime so Clerk's
    // clerkMiddleware (which uses AsyncLocalStorage) works correctly.
    if (nextRuntime === 'edge') {
      const polyfillPath = path.resolve(__dirname, 'src/polyfills/async-hooks.js');
      // Intercept the external resolution for node:async_hooks
      const existingExternals = config.externals ?? [];
      config.externals = [
        ...existingExternals.filter(e => typeof e !== 'function'),
        ({ request }, callback) => {
          if (request === 'node:async_hooks' || request === 'async_hooks') {
            // Return the polyfill path instead of the Node.js module
            return callback(null, `commonjs ${polyfillPath}`);
          }
          callback();
        },
      ];
      // Also use NormalModuleReplacementPlugin as a backup
      config.plugins = config.plugins ?? [];
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^(node:)?async_hooks$/,
          polyfillPath
        )
      );
    }

    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'prisma'],
  },
};
export default nextConfig;
