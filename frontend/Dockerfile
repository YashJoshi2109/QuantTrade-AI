# ============================================
# QuantTrade Frontend - Production Dockerfile
# Multi-stage build for Next.js
# ============================================

# Stage 1: Dependencies
FROM node:18-alpine AS deps

WORKDIR /app

# Install dependencies needed for node-gyp
RUN apk add --no-cache libc6-compat

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Stage 2: Builder
FROM node:18-alpine AS builder

WORKDIR /app

# Accept build arguments
ARG NEXT_PUBLIC_API_URL=https://www.quanttrade.us

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set environment variables for build (ARG becomes ENV for the build process)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Increase Node.js memory limit for build and disable experimental features
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Build the application
RUN npm run build

# Stage 3: Production Runner
FROM node:18-alpine AS runner

WORKDIR /app

# Set environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Set ownership
RUN chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Set hostname
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start Next.js
CMD ["node", "server.js"]
