/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Remove 'standalone' for Vercel - it handles this automatically
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://quanttrade.us',
  },
  images: {
    unoptimized: false,
  },
  // Optimize build for lower memory usage
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns'],
  },
}

module.exports = nextConfig
