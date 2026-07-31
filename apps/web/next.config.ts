import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Output configuration — standalone is used by the containerized (Linux)
  // deployment. On Windows it is omitted: the standalone trace step needs
  // to re-create pnpm's symlinked node_modules, which requires symlink
  // privileges (EPERM) and fails the build.
  // eslint-disable-next-line no-restricted-syntax -- `as const` is the only way to narrow the literal type for the Next.js config option
  ...(process.platform === 'win32' ? {} : { output: 'standalone' as const }),

  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
  },

  // Experimental features
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default withNextIntl(nextConfig);
