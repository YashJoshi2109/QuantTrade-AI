/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Enable standalone output for Docker deployment
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://www.quanttrade.us',
  },
  images: {
    unoptimized: false,
  },
}

module.exports = nextConfig
