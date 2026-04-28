/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Enable standalone output for Docker deployment
  output: 'standalone',
  env: {
    // Empty string = same origin. Client-side fetches go to the frontend domain,
    // then Next.js rewrites (Vercel) or nginx (Docker) proxy /api/v1/* to the backend.
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
  },
  images: {
    unoptimized: false,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.r2.dev',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8000',
        pathname: '/static/**',
      },
      {
        protocol: 'https',
        hostname: 'quanttrade.us',
        pathname: '/static/**',
      },
      {
        protocol: 'https',
        hostname: 'www.quanttrade.us',
        pathname: '/static/**',
      },
    ],
  },
  // Compress responses (Brotli via Cloudflare, gzip as fallback)
  compress: true,
  // Powered-by header removal (security best practice)
  poweredByHeader: false,
  // Proxy /api/v1/* to backend (replaces nginx when deployed on Vercel/serverless).
  // Set BACKEND_URL env var on Vercel (e.g. https://quanttrade-backend.onrender.com).
  // In Docker, nginx handles this so BACKEND_URL can be omitted.
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || process.env.BACKEND_INTERNAL_URL
    if (!backendUrl) return []
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendUrl.replace(/\/$/, '')}/api/v1/:path*`,
      },
    ]
  },
  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // HSTS — tell browsers to always use HTTPS (1 year)
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // Prevent MIME type sniffing
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Prevent clickjacking
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // XSS protection (legacy browsers)
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          // Referrer policy
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // DNS prefetch control
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          // Permissions policy — restrict browser features
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(self), usb=()',
          },
          // Content Security Policy
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://www.googletagmanager.com https://www.google-analytics.com https://accounts.google.com https://apis.google.com https://embed.polymarket.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https: http:",
              `connect-src 'self' ${process.env.NODE_ENV === 'development' ? 'http://localhost:8000 http://127.0.0.1:8000 http://localhost:3000 ws://localhost:8000 ws://127.0.0.1:8000' : ''} https://www.quanttrade.us https://quanttrade.us https://quanttrade-live-visitors.yashjosh7486.workers.dev https://challenges.cloudflare.com https://www.google-analytics.com https://analytics.google.com https://accounts.google.com https://apis.google.com https://gamma-api.polymarket.com wss:`,
              "frame-src 'self' https://challenges.cloudflare.com https://accounts.google.com https://js.stripe.com https://www.youtube.com https://embed.polymarket.com https://polymarket.com",
              "worker-src 'self' blob:",
              `media-src 'self' blob: ${process.env.NODE_ENV === 'development' ? 'http://localhost:8000 http://127.0.0.1:8000' : 'https://quanttrade.us https://www.quanttrade.us'} https:`,
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
