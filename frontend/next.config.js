/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // Optimized for Netlify
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'|| 'https://sunny-hamster-0012a0.netlify.app/',
  },
  // Optimize for Netlify
  images: {
    unoptimized: false,
  },
}

module.exports = nextConfig
