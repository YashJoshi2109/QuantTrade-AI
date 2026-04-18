import type { Metadata } from 'next'
import Script from 'next/script'
import { Manrope, Inter } from 'next/font/google'
import './globals.css'
import { ReactQueryProvider } from '@/lib/react-query'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/components/Toast'
import ChatWidget from '@/components/chat/ChatWidget'
import BrandIntroGate from '@/components/BrandIntroGate'
import { StockSnapshotProvider } from '@/context/StockSnapshotContext'
import { ThemeProvider } from '@/components/ThemeProvider'
import VisitorHeartbeat from '@/components/VisitorHeartbeat'

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const BASE_URL = 'https://quanttrade.us'

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'QuantTrade AI — AI-Powered Stock Research & Trading Platform',
    template: '%s | QuantTrade AI',
  },
  description:
    'Professional AI trading research platform. Real-time stock analysis, strategy backtesting, geopolitical market intelligence, SEC filing deep-dives, and AI copilot for active traders.',
  keywords: [
    'AI stock research', 'algorithmic trading', 'stock backtesting', 'trading copilot',
    'geopolitical market intelligence', 'SEC filing analysis', 'quantitative trading',
    'market intelligence platform', 'AI trading tools', 'stock analysis AI',
  ],
  authors: [{ name: 'Yash Joshi', url: 'https://github.com/YashJoshi2109' }],
  creator: 'Yash Joshi',
  publisher: 'QuantTrade AI',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: BASE_URL,
    siteName: 'QuantTrade AI',
    title: 'QuantTrade AI — AI-Powered Stock Research & Trading Platform',
    description:
      'Professional AI trading research platform. Real-time stock analysis, strategy backtesting, geopolitical market intelligence, and AI copilot for active traders.',
    images: [
      {
        url: `${BASE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'QuantTrade AI — Bloomberg-style AI trading research terminal',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@quanttradeai',
    creator: '@yashjoshi',
    title: 'QuantTrade AI — AI-Powered Stock Research & Trading Platform',
    description:
      'Professional AI trading research. Real-time analysis, backtesting, geopolitical monitor, and AI copilot.',
    images: [`${BASE_URL}/og-image.png`],
  },
  alternates: {
    canonical: BASE_URL,
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
  },
  verification: {
    // Add Google Search Console verification token here when available
    // google: 'your-verification-token',
  },
}

// ── Structured data (JSON-LD) ────────────────────────────────────────

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'QuantTrade AI',
  url: BASE_URL,
  logo: `${BASE_URL}/favicon.svg`,
  contactPoint: {
    '@type': 'ContactPoint',
    email: 'support@quanttrade.us',
    contactType: 'customer support',
  },
  founder: {
    '@type': 'Person',
    name: 'Yash Joshi',
    url: 'https://github.com/YashJoshi2109',
  },
  sameAs: ['https://github.com/YashJoshi2109'],
}

const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'QuantTrade AI',
  url: BASE_URL,
  description: 'AI-powered stock trading research and analysis platform',
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${BASE_URL}/research?symbol={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
}

const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'QuantTrade AI',
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web',
  url: BASE_URL,
  description:
    'Professional AI trading research platform with real-time stock analysis, strategy backtesting, geopolitical market intelligence, SEC filing deep-dives, and AI trading copilot.',
  offers: [
    {
      '@type': 'Offer',
      name: 'Free Plan',
      price: '0',
      priceCurrency: 'USD',
      description: 'Markets dashboard, basic symbol research, 3 AI queries per day',
    },
    {
      '@type': 'Offer',
      name: 'QuantTrade Pro',
      price: '8',
      priceCurrency: 'USD',
      billingIncrement: 'P1M',
      description: 'Unlimited AI copilot, full backtester, Global Monitor, SEC deep-dives',
      url: `${BASE_URL}/pricing`,
    },
  ],
  featureList: [
    'AI Trading Copilot',
    'Strategy Backtesting with Monte Carlo',
    'Global Geopolitical Monitor',
    'SEC Filing Analysis with RAG',
    'Real-time Stock Research',
    'Technical Indicators',
    'Market Heatmap',
    'Prediction Markets (Polymarket)',
  ],
  screenshot: `${BASE_URL}/og-image.png`,
  creator: {
    '@type': 'Person',
    name: 'Yash Joshi',
  },
}

function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID
  const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

  return (
    <html lang="en" suppressHydrationWarning className={`${manrope.variable} ${inter.variable}`}>
      <head>
        {/* Structured data */}
        <JsonLd data={organizationSchema} />
        <JsonLd data={websiteSchema} />
        <JsonLd data={softwareSchema} />

        {/* Google Tag Manager */}
        {gtmId && (
          <Script id="gtm-base" strategy="afterInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`}
          </Script>
        )}

        {/* Google Analytics 4 */}
        {gaMeasurementId && (
          <>
            <Script id="ga4-src" src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`} strategy="afterInteractive" />
            <Script id="ga4-init" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaMeasurementId}',{page_path:window.location.pathname});`}
            </Script>
          </>
        )}
      </head>
      <body>
        {gtmId && (
          <noscript
            dangerouslySetInnerHTML={{
              __html: `<iframe src="https://www.googletagmanager.com/ns.html?id=${gtmId}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`,
            }}
          />
        )}
        <ThemeProvider>
          <ErrorBoundary>
            <AuthProvider>
              <ReactQueryProvider>
                <ToastProvider>
                  <StockSnapshotProvider>
                    <VisitorHeartbeat />
                    <BrandIntroGate />
                    {children}
                    <ChatWidget />
                  </StockSnapshotProvider>
                </ToastProvider>
              </ReactQueryProvider>
            </AuthProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  )
}
