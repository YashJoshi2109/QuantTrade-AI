import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import { ReactQueryProvider } from '@/lib/react-query'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/components/Toast'
import ChatWidget from '@/components/chat/ChatWidget'

export const metadata: Metadata = {
  title: 'QuantTrade AI',
  description: 'AI-powered trading and research platform',
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID
  const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

  return (
    <html lang="en">
      <head>
        {/* Google Tag Manager */}
        {gtmId && (
          <Script id="gtm-base" strategy="afterInteractive">
            {`
              (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
              new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
              j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
              'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
              })(window,document,'script','dataLayer','${gtmId}');
            `}
          </Script>
        )}

        {/* Google Analytics (GA4) via gtag.js */}
        {gaMeasurementId && (
          <>
            <Script
              id="ga4-src"
              src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${gaMeasurementId}', {
                  page_path: window.location.pathname
                });
              `}
            </Script>
          </>
        )}
      </head>
      <body>
        {/* Google Tag Manager (noscript) */}
        {gtmId && (
          <noscript
            dangerouslySetInnerHTML={{
              __html: `<iframe src="https://www.googletagmanager.com/ns.html?id=${gtmId}"
height="0" width="0" style="display:none;visibility:hidden"></iframe>`,
            }}
          />
        )}
        <ErrorBoundary>
          <AuthProvider>
            <ReactQueryProvider>
              <ToastProvider>
                {children}
                {/* Global chat widget (desktop + mobile) */}
                <ChatWidget />
              </ToastProvider>
            </ReactQueryProvider>
          </AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
