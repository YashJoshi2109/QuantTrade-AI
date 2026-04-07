'use client'

/**
 * QuantTrade AI — Terms of Service & Privacy Policy
 *
 * Production-grade financial platform legal document.
 * Features:
 *   - Scroll progress bar pinned to top
 *   - Sticky table of contents with active section highlight
 *   - Financial-grade content (risk disclosures, no-advice disclaimer, arbitration)
 *   - Syne + DM Sans typography system
 *   - Print-friendly
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { motion, useScroll, useSpring } from 'framer-motion'
import { TrendingUp, ArrowLeft, ChevronRight, Shield, AlertTriangle, Scale } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const LAST_UPDATED = 'April 4, 2026'
const VERSION = '3.1'

interface Section {
  id: string
  title: string
  icon?: LucideIcon
}

const SECTIONS: Section[] = [
  { id: 'overview',        title: '1. Overview & Acceptance',     icon: Shield },
  { id: 'eligibility',     title: '2. Eligibility' },
  { id: 'no-advice',       title: '3. Not Investment Advice',     icon: AlertTriangle },
  { id: 'risk',            title: '4. Risk Disclosure',           icon: AlertTriangle },
  { id: 'accounts',        title: '5. Account Registration' },
  { id: 'subscriptions',   title: '6. Subscriptions & Billing' },
  { id: 'data',            title: '7. Data & Market Information' },
  { id: 'ai-services',     title: '8. AI & Automated Services' },
  { id: 'ip',              title: '9. Intellectual Property' },
  { id: 'privacy',         title: '10. Privacy Policy',           icon: Shield },
  { id: 'prohibited',      title: '11. Prohibited Use' },
  { id: 'liability',       title: '12. Limitation of Liability',  icon: Scale },
  { id: 'indemnification', title: '13. Indemnification' },
  { id: 'arbitration',     title: '14. Dispute Resolution',       icon: Scale },
  { id: 'termination',     title: '15. Termination' },
  { id: 'changes',         title: '16. Changes to Terms' },
  { id: 'contact',         title: '17. Contact Information' },
]

function SectionHeading({ id, title, icon: Icon }: Section) {
  return (
    <h2
      id={id}
      className="flex items-center gap-2.5 text-xl font-bold text-[#F0F6FF] mb-4 pt-6 scroll-mt-20"
      style={{ fontFamily: 'Syne, sans-serif' }}
    >
      {Icon && <Icon className="w-5 h-5 text-[#00D4FF] shrink-0" />}
      {title}
    </h2>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[#94A3B8] text-sm leading-[1.85] mb-4">{children}</p>
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-2 mb-4 pl-5">{children}</ul>
}

function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-[#94A3B8] leading-relaxed">
      <ChevronRight className="w-3.5 h-3.5 text-[#00D4FF]/60 mt-0.5 shrink-0" />
      <span>{children}</span>
    </li>
  )
}

function Callout({ type, children }: { type: 'warning' | 'info'; children: React.ReactNode }) {
  const isWarning = type === 'warning'
  return (
    <div
      className={`rounded-xl border p-4 mb-5 ${
        isWarning
          ? 'border-[#FF8C42]/30 bg-[#FF8C42]/5'
          : 'border-[#00D4FF]/20 bg-[#00D4FF]/5'
      }`}
    >
      <p className={`text-sm leading-relaxed ${isWarning ? 'text-[#FFB86C]' : 'text-[#7DD3FC]'}`}>
        {children}
      </p>
    </div>
  )
}

function HR() {
  return <div className="h-px bg-gradient-to-r from-transparent via-[#1E293B] to-transparent my-8" />
}

export default function TermsPage() {
  const [activeSection, setActiveSection] = useState('overview')
  const [tocOpen, setTocOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 })

  // Active section tracking
  const updateActive = useCallback(() => {
    const offsets = SECTIONS.map(({ id }) => {
      const el = document.getElementById(id)
      if (!el) return { id, top: Infinity }
      return { id, top: el.getBoundingClientRect().top }
    })
    const visible = offsets.filter((o) => o.top <= 120)
    if (visible.length > 0) {
      const latest = visible[visible.length - 1]
      setActiveSection(latest.id)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('scroll', updateActive, { passive: true })
    return () => window.removeEventListener('scroll', updateActive)
  }, [updateActive])

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setTocOpen(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#060B12]" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
        @media print {
          .no-print { display: none !important; }
          .prose-area { margin: 0; max-width: 100% !important; }
          body { background: white !important; color: black !important; }
        }
      `}</style>

      {/* Scroll progress bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#00D4FF] to-[#00E5A0] z-50 origin-left no-print"
        style={{ scaleX }}
      />

      {/* Nav bar */}
      <nav className="sticky top-0 z-40 border-b border-[#0D1828] bg-[#060B12]/90 backdrop-blur-xl no-print">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/auth" className="flex items-center gap-1.5 text-[#475569] hover:text-[#94A3B8] text-sm transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Auth
            </Link>
            <span className="text-[#1E293B]">·</span>
            <Link href="/" className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-[#00D4FF]/10 border border-[#00D4FF]/30 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-[#00D4FF]" />
              </div>
              <span className="text-[#F0F6FF] text-sm font-semibold" style={{ fontFamily: 'Syne, sans-serif' }}>
                QuantTrade AI
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[#334155] text-xs hidden sm:block">
              v{VERSION} · Updated {LAST_UPDATED}
            </span>
            <button
              onClick={() => window.print()}
              className="hidden sm:block text-xs text-[#475569] hover:text-[#94A3B8] border border-[#1E293B] rounded-lg px-3 py-1.5 transition-colors"
            >
              Print PDF
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-12 flex gap-12">

        {/* ── Table of Contents (Desktop) ── */}
        <aside className="hidden lg:block w-64 shrink-0 no-print">
          <div className="sticky top-20">
            <p className="text-[10px] font-semibold tracking-[2px] text-[#334155] uppercase mb-3">
              Contents
            </p>
            <nav className="space-y-0.5">
              {SECTIONS.map(({ id, title }) => (
                <button
                  key={id}
                  onClick={() => scrollTo(id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all duration-150 ${
                    activeSection === id
                      ? 'bg-[#00D4FF]/10 text-[#00D4FF] border border-[#00D4FF]/20'
                      : 'text-[#475569] hover:text-[#94A3B8] hover:bg-[#0D1828]'
                  }`}
                >
                  {title}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* ── Main Content ── */}
        <div ref={contentRef} className="flex-1 max-w-3xl prose-area">

          {/* Header */}
          <div className="mb-10">
            <div className="inline-block px-3 py-1 rounded-full border border-[#1E293B] bg-[#0D1828] mb-4">
              <span className="text-[#00D4FF] text-xs font-semibold">Legal Document · v{VERSION}</span>
            </div>
            <h1 className="text-3xl font-bold text-[#F0F6FF] mb-3" style={{ fontFamily: 'Syne, sans-serif' }}>
              Terms of Service &amp; Privacy Policy
            </h1>
            <p className="text-[#475569] text-sm">
              Last updated: <span className="text-[#64748B]">{LAST_UPDATED}</span> · Effective immediately upon account creation.
            </p>

            <Callout type="warning">
              <strong>Important:</strong> QuantTrade AI is a financial data and analysis platform. It does not provide investment advice, brokerage services, or custodial accounts. Nothing on this platform constitutes a recommendation to buy, sell, or hold any security.
            </Callout>
          </div>

          <HR />

          {/* ── 1. Overview ── */}
          <SectionHeading {...SECTIONS[0]} />
          <P>
            These Terms of Service ("Terms") govern your access to and use of QuantTrade AI (the "Platform"), including our website, mobile application, APIs, and all related services operated by QuantTrade Technologies, Inc. ("Company", "we", "us", "our").
          </P>
          <P>
            By creating an account or accessing the Platform, you acknowledge that you have read, understood, and agree to be bound by these Terms and our Privacy Policy. If you do not agree, you must not access or use the Platform.
          </P>
          <UL>
            <LI>These Terms apply to all visitors, registered users, and subscribers of the Platform.</LI>
            <LI>Use of the Platform is governed by the laws of the State of Delaware, United States.</LI>
            <LI>We may update these Terms from time to time. Continued use after updates constitutes acceptance.</LI>
          </UL>

          <HR />

          {/* ── 2. Eligibility ── */}
          <SectionHeading {...SECTIONS[1]} />
          <P>
            To use QuantTrade AI, you must be at least 18 years of age (or the age of majority in your jurisdiction, whichever is higher). By using the Platform, you represent that you meet these eligibility requirements.
          </P>
          <P>
            The Platform is not available to persons who have been previously suspended or removed from the Platform, or in jurisdictions where the Platform is prohibited by law. You are responsible for compliance with all applicable local laws.
          </P>

          <HR />

          {/* ── 3. Not Investment Advice ── */}
          <SectionHeading {...SECTIONS[2]} />
          <Callout type="warning">
            QuantTrade AI IS NOT A REGISTERED INVESTMENT ADVISER, BROKER-DEALER, OR FINANCIAL PLANNER under the Investment Advisers Act of 1940, the Securities Exchange Act of 1934, or any applicable state or foreign law.
          </Callout>
          <P>
            All information, analyses, AI-generated insights, charts, backtests, research, and content provided through the Platform are for <strong className="text-[#E2E8F0]">informational and educational purposes only</strong>. They do not constitute:
          </P>
          <UL>
            <LI>Investment advice or recommendations to buy, sell, or hold any security</LI>
            <LI>Financial planning or tax advice</LI>
            <LI>Legal advice regarding securities law compliance</LI>
            <LI>A solicitation to engage in any investment transaction</LI>
            <LI>A warranty or guarantee of any specific outcome or trading performance</LI>
          </UL>
          <P>
            You should consult a licensed financial advisor, attorney, or tax professional before making any investment decision. Past performance shown on the Platform is not indicative of future results.
          </P>

          <HR />

          {/* ── 4. Risk Disclosure ── */}
          <SectionHeading {...SECTIONS[3]} />
          <Callout type="warning">
            Trading securities, derivatives, cryptocurrencies, and other financial instruments involves significant risk of loss. You should only trade with capital you can afford to lose entirely.
          </Callout>
          <P>
            Specific risks include, without limitation:
          </P>
          <UL>
            <LI><strong className="text-[#E2E8F0]">Market Risk:</strong> Securities prices can fluctuate dramatically due to market conditions, economic events, geopolitical factors, and other unpredictable circumstances.</LI>
            <LI><strong className="text-[#E2E8F0]">Liquidity Risk:</strong> Securities may become difficult or impossible to sell at favorable prices.</LI>
            <LI><strong className="text-[#E2E8F0]">Algorithm Risk:</strong> AI-generated analyses and backtested strategies may contain errors, biases, or may not reflect current market conditions.</LI>
            <LI><strong className="text-[#E2E8F0]">Data Accuracy Risk:</strong> Market data displayed may be delayed, inaccurate, or subject to errors from third-party data providers.</LI>
            <LI><strong className="text-[#E2E8F0]">Technology Risk:</strong> Platform outages, API failures, or connectivity issues may prevent timely access.</LI>
            <LI><strong className="text-[#E2E8F0]">Regulatory Risk:</strong> Changes in securities regulation may impact trading strategies or the availability of certain instruments.</LI>
          </UL>
          <P>
            AI-generated backtesting results represent hypothetical performance and are subject to inherent limitations. Backtests may be subject to overfitting bias and do not account for slippage, market impact, commissions, or liquidity constraints.
          </P>

          <HR />

          {/* ── 5. Accounts ── */}
          <SectionHeading {...SECTIONS[4]} />
          <P>
            You must provide accurate, current, and complete information when creating an account. You are responsible for maintaining the confidentiality of your login credentials and for all activities under your account.
          </P>
          <UL>
            <LI>You may not share your account credentials with any third party.</LI>
            <LI>You must notify us immediately at security@quanttrade.us if you suspect unauthorized access.</LI>
            <LI>One account per individual is permitted. Multiple accounts to circumvent restrictions are prohibited.</LI>
            <LI>We reserve the right to suspend or terminate accounts that violate these Terms.</LI>
            <LI>You are responsible for all activity conducted through your account, whether authorized or not.</LI>
          </UL>
          <P>
            We implement multi-factor authentication (MFA) and encourage you to enable it. We will send security notifications to your registered email address for sign-in events, including the originating IP address. You should review these alerts and contact us immediately if you do not recognize a sign-in.
          </P>

          <HR />

          {/* ── 6. Subscriptions ── */}
          <SectionHeading {...SECTIONS[5]} />
          <P>
            QuantTrade AI offers both free and paid subscription tiers. Paid subscriptions are billed in advance on a monthly or annual basis. By subscribing, you authorize us to charge your payment method on a recurring basis.
          </P>
          <UL>
            <LI>Subscription fees are non-refundable except as required by applicable law or as stated in our refund policy.</LI>
            <LI>We may change subscription fees with 30 days' notice to your registered email. Continued use constitutes acceptance.</LI>
            <LI>You may cancel your subscription at any time; cancellation takes effect at the end of the current billing period.</LI>
            <LI>Downgrading your subscription may result in loss of access to certain features and data.</LI>
          </UL>

          <HR />

          {/* ── 7. Data ── */}
          <SectionHeading {...SECTIONS[6]} />
          <P>
            Market data, prices, financial information, and news displayed on the Platform are sourced from third-party data providers. This data may be delayed by 15 minutes or more unless you have a real-time data subscription.
          </P>
          <Callout type="info">
            Market data is provided "as is" without warranty of any kind. QuantTrade AI is not responsible for the accuracy, completeness, or timeliness of any data provided by third-party sources.
          </Callout>
          <P>
            You agree not to redistribute, resell, or commercially exploit market data obtained through the Platform without written authorization from us and the relevant data providers.
          </P>

          <HR />

          {/* ── 8. AI Services ── */}
          <SectionHeading {...SECTIONS[7]} />
          <P>
            The Platform employs artificial intelligence and machine learning technologies to generate analyses, pattern recognition, risk assessments, and other insights. You acknowledge and agree that:
          </P>
          <UL>
            <LI>AI-generated outputs are probabilistic estimates and may contain errors or hallucinations.</LI>
            <LI>AI analyses should be treated as one input among many, not as definitive guidance.</LI>
            <LI>AI models are trained on historical data and may not accurately predict future market behavior.</LI>
            <LI>We do not guarantee the accuracy, reliability, or completeness of AI-generated content.</LI>
            <LI>You should independently verify AI-generated insights before making any financial decision.</LI>
          </UL>

          <HR />

          {/* ── 9. IP ── */}
          <SectionHeading {...SECTIONS[8]} />
          <P>
            All content on the Platform, including but not limited to text, graphics, logos, algorithms, software, AI models, and interfaces, is the exclusive property of QuantTrade Technologies, Inc. or its licensors and is protected by copyright, trademark, and other intellectual property laws.
          </P>
          <P>
            You are granted a limited, non-exclusive, non-transferable license to access and use the Platform for your personal, non-commercial purposes. You may not copy, modify, reproduce, distribute, or create derivative works based on Platform content.
          </P>

          <HR />

          {/* ── 10. Privacy ── */}
          <SectionHeading {...SECTIONS[9]} />
          <P>
            We collect and process information about you in accordance with this Privacy Policy. By using the Platform, you consent to the collection, use, and disclosure of your information as described herein.
          </P>
          <P>
            <strong className="text-[#E2E8F0]">Information We Collect:</strong>
          </P>
          <UL>
            <LI>Account information: name, email address, username, and password (stored as a bcrypt hash)</LI>
            <LI>Usage data: pages visited, features used, session duration, and interaction logs</LI>
            <LI>Device and network data: IP address, browser type, operating system, and device identifiers</LI>
            <LI>Financial preferences: watchlists, saved searches, trading strategies, and preferences</LI>
            <LI>Payment information: processed securely through Stripe; we do not store full card numbers</LI>
          </UL>
          <P>
            <strong className="text-[#E2E8F0]">How We Use Your Data:</strong>
          </P>
          <UL>
            <LI>To provide, maintain, and improve the Platform</LI>
            <LI>To send security notifications (including sign-in alerts with IP information)</LI>
            <LI>To personalize your experience and improve AI model performance</LI>
            <LI>To process payments and manage subscription billing</LI>
            <LI>To comply with legal obligations and respond to lawful requests</LI>
            <LI>To detect and prevent fraud, abuse, and security incidents</LI>
          </UL>
          <P>
            We do not sell your personal information to third parties. We may share data with service providers acting on our behalf (e.g., cloud infrastructure, email delivery, payment processing) subject to confidentiality obligations.
          </P>
          <P>
            We retain your data for as long as your account is active or as needed to provide services. Upon account deletion, we will delete or anonymize your personal data within 30 days, except as required by law.
          </P>
          <Callout type="info">
            If you are located in the European Economic Area (EEA) or United Kingdom, you have additional rights under GDPR/UK GDPR including the right to access, rectify, erase, or port your personal data. Contact us at privacy@quanttrade.us.
          </Callout>

          <HR />

          {/* ── 11. Prohibited Use ── */}
          <SectionHeading {...SECTIONS[10]} />
          <P>
            You may not use the Platform for any of the following:
          </P>
          <UL>
            <LI>Market manipulation, wash trading, or any activity that violates securities laws</LI>
            <LI>Unauthorized scraping, harvesting, or automated extraction of Platform data</LI>
            <LI>Attempting to circumvent access controls, security measures, or subscription limits</LI>
            <LI>Uploading malware, viruses, or malicious code</LI>
            <LI>Impersonating another user, company, or entity</LI>
            <LI>Using the Platform to violate any applicable local, state, national, or international law</LI>
            <LI>Training or fine-tuning competing AI models using Platform data or outputs</LI>
            <LI>Reverse engineering, decompiling, or disassembling Platform software</LI>
          </UL>

          <HR />

          {/* ── 12. Liability ── */}
          <SectionHeading {...SECTIONS[11]} />
          <Callout type="warning">
            TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, QUANTTRADE TECHNOLOGIES, INC. SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES.
          </Callout>
          <P>
            Our total liability to you for any claim arising out of or relating to these Terms or the Platform shall not exceed the greater of (a) the amounts you paid to us in the 12 months preceding the claim, or (b) US$100.
          </P>
          <P>
            We do not warrant that the Platform will be error-free, uninterrupted, or free of viruses or other harmful components. The Platform is provided "AS IS" and "AS AVAILABLE" without warranties of any kind, whether express or implied.
          </P>

          <HR />

          {/* ── 13. Indemnification ── */}
          <SectionHeading {...SECTIONS[12]} />
          <P>
            You agree to indemnify, defend, and hold harmless QuantTrade Technologies, Inc. and its officers, directors, employees, agents, and licensors from and against any claims, liabilities, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising out of or relating to:
          </P>
          <UL>
            <LI>Your use of the Platform in violation of these Terms</LI>
            <LI>Your violation of any applicable law, regulation, or third-party right</LI>
            <LI>Any investment or financial decisions you make based on Platform content</LI>
          </UL>

          <HR />

          {/* ── 14. Dispute Resolution ── */}
          <SectionHeading {...SECTIONS[13]} />
          <P>
            <strong className="text-[#E2E8F0]">Binding Arbitration.</strong> Any dispute, controversy, or claim arising out of or relating to these Terms or the Platform shall be resolved by binding arbitration administered by the American Arbitration Association (AAA) under its Commercial Arbitration Rules. The arbitration shall take place in Wilmington, Delaware, USA. The arbitrator's award shall be final and binding and may be entered as a judgment in any court of competent jurisdiction.
          </P>
          <P>
            <strong className="text-[#E2E8F0]">Class Action Waiver.</strong> You waive the right to participate in a class action lawsuit or class-wide arbitration. You may only bring claims on an individual basis.
          </P>
          <P>
            <strong className="text-[#E2E8F0]">Exceptions.</strong> Either party may seek emergency injunctive relief in any court of competent jurisdiction to prevent irreparable harm. Claims for less than US$1,000 may be brought in small claims court.
          </P>
          <P>
            <strong className="text-[#E2E8F0]">Opt-Out.</strong> You may opt out of this arbitration clause by sending written notice to legal@quanttrade.us within 30 days of first accepting these Terms. Opt-out does not affect other provisions.
          </P>

          <HR />

          {/* ── 15. Termination ── */}
          <SectionHeading {...SECTIONS[14]} />
          <P>
            We may suspend or terminate your access to the Platform at any time, for any reason, with or without notice, including for violations of these Terms. Upon termination, your right to use the Platform will immediately cease.
          </P>
          <P>
            You may terminate your account at any time by contacting support@quanttrade.us or through account settings. Upon termination, outstanding subscription payments remain due.
          </P>

          <HR />

          {/* ── 16. Changes ── */}
          <SectionHeading {...SECTIONS[15]} />
          <P>
            We reserve the right to modify these Terms at any time. We will notify registered users via email at least 14 days before material changes take effect. Your continued use of the Platform after the effective date constitutes your acceptance of the revised Terms.
          </P>

          <HR />

          {/* ── 17. Contact ── */}
          <SectionHeading {...SECTIONS[16]} />
          <div className="rounded-xl border border-[#1E293B] bg-[#0D1828]/50 p-5 space-y-2">
            {[
              { label: 'General:',     value: 'support@quanttrade.us' },
              { label: 'Privacy:',     value: 'privacy@quanttrade.us' },
              { label: 'Legal:',       value: 'legal@quanttrade.us' },
              { label: 'Security:',    value: 'security@quanttrade.us' },
              { label: 'Address:',     value: 'QuantTrade Technologies, Inc., 1201 N Orange St, Wilmington, DE 19801, USA' },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-start gap-3">
                <span className="text-[11px] font-semibold text-[#475569] uppercase tracking-widest w-16 shrink-0 mt-0.5">{label}</span>
                <span className="text-[#94A3B8] text-sm" style={{ fontFamily: label !== 'Address:' ? 'JetBrains Mono, monospace' : undefined }}>
                  {value}
                </span>
              </div>
            ))}
          </div>

          <HR />

          {/* Acknowledge gate */}
          <div className="rounded-2xl border border-[#00D4FF]/20 bg-[#00D4FF]/5 p-6 mt-8">
            <div className="flex items-start gap-3 mb-4">
              <Shield className="w-5 h-5 text-[#00D4FF] shrink-0 mt-0.5" />
              <div>
                <p className="text-[#F0F6FF] text-sm font-semibold mb-1" style={{ fontFamily: 'Syne, sans-serif' }}>
                  Ready to start trading smarter?
                </p>
                <p className="text-[#475569] text-xs leading-relaxed">
                  By creating an account you confirm you have read and agree to these Terms of Service, our Privacy Policy, and our Risk Disclosure. You understand QuantTrade AI provides informational tools, not investment advice.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/auth"
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 px-5 rounded-xl bg-gradient-to-r from-[#00D4FF] to-[#0A7CFF] text-[#060B12] font-bold text-sm transition-opacity hover:opacity-90"
                style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}
              >
                Back to Sign Up
              </Link>
              <Link
                href="/"
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 px-5 rounded-xl border border-[#1E293B] text-[#94A3B8] text-sm transition-colors hover:border-[#334155] hover:text-white"
              >
                Back to Home
              </Link>
            </div>
          </div>

          <p className="text-center text-[11px] text-[#1E293B] mt-6">
            QuantTrade Technologies, Inc. · v{VERSION} · {LAST_UPDATED}
          </p>
        </div>
      </div>
    </div>
  )
}
