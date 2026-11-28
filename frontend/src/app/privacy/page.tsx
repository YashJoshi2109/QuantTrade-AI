import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { JsonLd } from '@/components/seo/JsonLd'
import { routeMetadata } from '@/lib/routeSeo'
import { breadcrumbSchema } from '@/lib/schema'

export const metadata: Metadata = routeMetadata('/privacy')

const LAST_UPDATED = 'November 28, 2026'
const PRIVACY_EMAIL = 'privacy@quanttrade.us'

function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 border-b border-white/5 pb-3 pt-8 mb-4 text-xl font-bold text-white">
      {children}
    </h2>
  )
}

function P({ children }: { children: ReactNode }) {
  return <p className="mb-4 text-sm leading-[1.9] text-[#8B9BB4]">{children}</p>
}

function UL({ children }: { children: ReactNode }) {
  return <ul className="mb-5 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[#8B9BB4] marker:text-[#00D4FF]">{children}</ul>
}

const strong = 'text-white/80 font-semibold'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #060B12 0%, #0A1628 50%, #060B12 100%)' }}>
      <JsonLd
        data={breadcrumbSchema([
          { name: 'Legal', path: '/legal' },
          { name: 'Privacy Policy', path: '/privacy' },
        ])}
      />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <nav aria-label="Breadcrumb" className="mb-6 text-xs text-[#8B9BB4]">
          <Link href="/" className="hover:text-white">Home</Link>
          <span className="mx-2" aria-hidden>/</span>
          <Link href="/legal" className="hover:text-white">Legal</Link>
          <span className="mx-2" aria-hidden>/</span>
          <span className="text-white/80">Privacy Policy</span>
        </nav>

        <h1 className="text-3xl font-bold text-white sm:text-4xl">Privacy Policy</h1>
        <p className="mt-2 text-xs text-[#8B9BB4]">Last updated {LAST_UPDATED}</p>

        <P>
          This policy explains what information QuantTrade AI (&quot;we&quot;, &quot;us&quot;) collects when you use
          www.quanttrade.us (the &quot;Platform&quot;), how we use it, and who processes it on our behalf. It is part of
          our <Link href="/terms" className="text-[#00D4FF] hover:underline">Terms of Service</Link>.
        </P>

        <H2 id="collect">Information we collect</H2>
        <UL>
          <li><span className={strong}>Account information:</span> your email address, and the name and username you choose. Passwords are stored only as a bcrypt hash.</li>
          <li><span className={strong}>Usage data:</span> pages visited, features used, session duration and interaction logs.</li>
          <li><span className={strong}>Device and network data:</span> IP address, browser type, operating system and device identifiers.</li>
          <li><span className={strong}>Preferences you save:</span> watchlists, alerts, saved searches, strategies and settings.</li>
          <li><span className={strong}>Content you submit:</span> community posts and comments, and the questions you ask the AI copilot.</li>
          <li><span className={strong}>Payment information:</span> handled by Stripe. We do not receive or store full card numbers.</li>
        </UL>

        <H2 id="use">How we use it</H2>
        <UL>
          <li>To provide, maintain and improve the Platform.</li>
          <li>To send account and security notifications, such as sign-in alerts.</li>
          <li>To personalize your experience (for example, your watchlist and alerts).</li>
          <li>To process payments and manage your subscription.</li>
          <li>To detect and prevent fraud, abuse and security incidents.</li>
        </UL>

        <H2 id="cookies">Cookies and analytics</H2>
        <P>
          We use an essential cookie to keep you signed in. We also use Google Analytics, which sets its own cookies, to
          understand how the Platform is used in aggregate (for example, which pages are visited). You can block or
          delete cookies in your browser settings; the Platform will still work, but you will need to sign in again.
        </P>

        <H2 id="processors">Service providers that process data for us</H2>
        <UL>
          <li><span className={strong}>Amazon Web Services (AWS):</span> application hosting and database.</li>
          <li><span className={strong}>Cloudflare:</span> DNS, content delivery and protection against abuse.</li>
          <li><span className={strong}>Stripe:</span> payment processing and subscription billing.</li>
          <li><span className={strong}>Google Analytics:</span> aggregate usage analytics.</li>
          <li>
            <span className={strong}>AI model providers:</span> when you use the AI copilot or AI analysis, your question and
            the relevant market data are sent to a third-party large language model provider to generate the answer.
          </li>
        </UL>
        <P>These providers process data only to deliver their service to us.</P>

        <H2 id="rights">Your choices and rights</H2>
        <P>
          You can update your profile and saved preferences in Settings. To request access to, correction of, or deletion
          of your account data, email <a href={`mailto:${PRIVACY_EMAIL}`} className="text-[#00D4FF] hover:underline">{PRIVACY_EMAIL}</a>.
          If you are located in the EEA or United Kingdom, you have additional rights under GDPR / UK GDPR, including the
          right to access, rectify, erase or port your personal data.
        </P>

        <H2 id="changes">Changes to this policy</H2>
        <P>
          We may update this policy as the Platform changes. The date at the top shows when it was last revised.
        </P>

        <H2 id="contact">Contact</H2>
        <P>
          Questions about privacy: <a href={`mailto:${PRIVACY_EMAIL}`} className="text-[#00D4FF] hover:underline">{PRIVACY_EMAIL}</a>.
          See also our <Link href="/terms" className="text-[#00D4FF] hover:underline">Terms of Service</Link> and{' '}
          <Link href="/legal" className="text-[#00D4FF] hover:underline">legal overview</Link>.
        </P>

        <p className="mt-10 border-t border-white/5 pt-6 text-xs leading-relaxed text-[#8B9BB4]">
          QuantTrade AI provides research and educational information, not investment advice.
        </p>
      </div>
    </div>
  )
}
