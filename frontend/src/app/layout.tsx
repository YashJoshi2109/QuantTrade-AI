import type { Metadata } from 'next'
import Script from 'next/script'
import localFont from 'next/font/local'
import './globals.css'
import { ReactQueryProvider } from '@/lib/react-query'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/components/Toast'
import DeferredGlobalWidgets from '@/components/DeferredGlobalWidgets'
import BrandIntroPoster from '@/components/BrandIntroPoster'
import { StockSnapshotProvider } from '@/context/StockSnapshotContext'
import { ThemeProvider } from '@/components/ThemeProvider'
import { ThemeSyncProvider } from '@/components/ThemeSyncProvider'
import VisitorHeartbeat from '@/components/VisitorHeartbeat'
import { JsonLd } from '@/components/seo/JsonLd'
import { OG_IMAGE, SITE_URL } from '@/lib/seo'
import { organizationSchema, websiteSchema } from '@/lib/schema'

// Self-hosted (src/fonts): next/font/google fetches at build time, which broke
// the Docker build when Google's CSS response changed. Latin, variable weight.
const manrope = localFont({
  src: '../fonts/manrope-latin-var.woff2',
  weight: '200 800',
  variable: '--font-manrope',
  display: 'swap',
})

const inter = localFont({
  src: '../fonts/inter-latin-var.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'QuantTrade AI: AI Stock Research, Screener & Backtesting',
    template: '%s | QuantTrade AI',
  },
  description:
    'Research US stocks with AI: SEC filing analysis, earnings and dividend calendars, a stock screener and strategy backtests, with dated, cited sources.',
  authors: [{ name: 'Yash Joshi', url: 'https://github.com/YashJoshi2109' }],
  creator: 'Yash Joshi',
  publisher: 'QuantTrade AI',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  // No openGraph.url and no alternates.canonical here: both are inherited by
  // every route that does not override them, which would point every page at
  // the homepage. Each public route sets its own (see lib/seo.ts).
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'QuantTrade AI',
    title: 'QuantTrade AI: AI Stock Research, Screener & Backtesting',
    description:
      'Research US stocks with AI: SEC filing analysis, earnings and dividend calendars, a stock screener and strategy backtests.',
    images: [{ ...OG_IMAGE }],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@quanttradeai',
    title: 'QuantTrade AI: AI Stock Research, Screener & Backtesting',
    description:
      'Research US stocks with AI: SEC filing analysis, earnings and dividend calendars, a stock screener and strategy backtests.',
    images: [OG_IMAGE.url],
  },
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png',
  },
  verification: {
    // Add Google Search Console verification token here when available
    // google: 'your-verification-token',
  },
}

import SkipToContent from '@/components/SkipToContent'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

  return (
    <html lang="en" suppressHydrationWarning className={`${manrope.variable} ${inter.variable}`}>
      <head>
        {/* Structured data */}
        <JsonLd data={organizationSchema} />
        <JsonLd data={websiteSchema} />

        {/* Google Analytics 4 (feeds the admin Traffic page). The GTM container
            (GTM-KWMSXH37) carried no tags, so only gtag is loaded, after the page
            is idle, to keep ~300KB of third-party JS off the critical path. */}
        {gaMeasurementId && (
          <>
            <Script id="ga4-src" src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`} strategy="lazyOnload" />
            <Script id="ga4-init" strategy="lazyOnload">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaMeasurementId}',{page_path:window.location.pathname});`}
            </Script>
          </>
        )}
      </head>
      <body>
        <SkipToContent />
        <BrandIntroPoster />
        <ThemeProvider>
          <ThemeSyncProvider>
            <ErrorBoundary>
              <AuthProvider>
                <ReactQueryProvider>
                  <ToastProvider>
                    <StockSnapshotProvider>
                      <VisitorHeartbeat />
                      {children}
                      <DeferredGlobalWidgets />
                    </StockSnapshotProvider>
                  </ToastProvider>
                </ReactQueryProvider>
              </AuthProvider>
            </ErrorBoundary>
          </ThemeSyncProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
