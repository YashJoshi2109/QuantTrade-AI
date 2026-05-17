'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { motion, useScroll, useSpring } from 'framer-motion'
import { TrendingUp, ArrowLeft, ChevronRight, Shield, AlertTriangle, Scale, FileText } from 'lucide-react'
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
      className="flex items-center gap-3 text-xl font-bold text-white mb-5 pt-8 scroll-mt-24 border-b border-white/5 pb-3"
      style={{ fontFamily: 'Syne, sans-serif' }}
    >
      {Icon && (
        <span className="w-8 h-8 rounded-lg bg-[#00D4FF]/10 border border-[#00D4FF]/20 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-[#00D4FF]" />
        </span>
      )}
      {title}
    </h2>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[#8B9BB4] text-sm leading-[1.9] mb-4">{children}</p>
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-2.5 mb-5 pl-1">{children}</ul>
}

function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm text-[#8B9BB4] leading-relaxed">
      <span className="w-5 h-5 rounded-full bg-[#00D4FF]/10 border border-[#00D4FF]/20 flex items-center justify-center shrink-0 mt-0.5">
        <ChevronRight className="w-2.5 h-2.5 text-[#00D4FF]" />
      </span>
      <span>{children}</span>
    </li>
  )
}

function Callout({ type, children }: { type: 'warning' | 'info'; children: React.ReactNode }) {
  const isWarning = type === 'warning'
  return (
    <div
      className={`rounded-xl border p-4 mb-5 flex gap-3 ${
        isWarning
          ? 'border-amber-500/25 bg-gradient-to-r from-amber-500/8 to-transparent'
          : 'border-[#00D4FF]/20 bg-gradient-to-r from-[#00D4FF]/8 to-transparent'
      }`}
    >
      <span className={`shrink-0 mt-0.5 ${isWarning ? 'text-amber-400' : 'text-[#00D4FF]'}`}>
        {isWarning ? <AlertTriangle className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
      </span>
      <p className={`text-sm leading-relaxed ${isWarning ? 'text-amber-200/80' : 'text-[#7DD3FC]'}`}>
        {children}
      </p>
    </div>
  )
}

function HR() {
  return (
    <div className="my-8 flex items-center gap-3">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/8 to-transparent" />
    </div>
  )
}

export default function TermsPage() {
  const [activeSection, setActiveSection] = useState('overview')
  const contentRef = useRef<HTMLDivElement>(null)

  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 })

  const updateActive = useCallback(() => {
    const offsets = SECTIONS.map(({ id }) => {
      const el = document.getElementById(id)
      if (!el) return { id, top: Infinity }
      return { id, top: el.getBoundingClientRect().top }
    })
    const visible = offsets.filter((o) => o.top <= 140)
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
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #060B12 0%, #0A1628 50%, #060B12 100%)', fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1E293B; border-radius: 2px; }
      `}</style>

      {/* Progress bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-[2px] z-50 origin-left no-print"
        style={{ scaleX, background: 'linear-gradient(90deg, #00D4FF, #0A7CFF, #00E5A0)' }}
      />

      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b border-white/5 no-print" style={{ background: 'rgba(6,11,18,0.85)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Link href="/auth" className="flex items-center gap-1.5 text-[#475569] hover:text-[#94A3B8] text-sm transition-colors group">
              <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
              Back
            </Link>
            <div className="w-px h-4 bg-white/10" />
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#00D4FF]/20 to-[#0A7CFF]/20 border border-[#00D4FF]/30 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-[#00D4FF]" />
              </div>
              <span className="text-white text-sm font-semibold" style={{ fontFamily: 'Syne, sans-serif' }}>
                QuantTrade AI
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[#334155] text-xs hidden sm:block">v{VERSION} · {LAST_UPDATED}</span>
            <button
              onClick={() => window.print()}
              className="hidden sm:flex items-center gap-1.5 text-xs text-[#475569] hover:text-[#94A3B8] border border-white/8 hover:border-white/15 rounded-lg px-3 py-1.5 transition-all"
            >
              <FileText className="w-3 h-3" />
              Print PDF
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-12 flex gap-10 relative">

        {/* Ambient glow */}
        <div className="fixed top-1/4 left-1/4 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.03) 0%, transparent 70%)' }} />

        {/* Table of Contents */}
        <aside className="hidden lg:block w-60 shrink-0 no-print">
          <div className="sticky top-24">
            <div className="rounded-2xl border border-white/6 overflow-hidden" style={{ background: 'rgba(13,24,40,0.8)', backdropFilter: 'blur(12px)' }}>
              <div className="px-4 py-3 border-b border-white/6">
                <p className="text-[10px] font-bold tracking-[2px] text-[#334155] uppercase">Contents</p>
              </div>
              <nav className="p-2 max-h-[calc(100vh-160px)] overflow-y-auto space-y-0.5">
                {SECTIONS.map(({ id, title, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => scrollTo(id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all duration-150 flex items-center gap-2 ${
                      activeSection === id
                        ? 'bg-[#00D4FF]/10 text-[#00D4FF] border border-[#00D4FF]/20'
                        : 'text-[#475569] hover:text-[#8B9BB4] hover:bg-white/4'
                    }`}
                  >
                    {Icon && <Icon className="w-3 h-3 shrink-0 opacity-70" />}
                    <span className="truncate">{title}</span>
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div ref={contentRef} className="flex-1 max-w-3xl min-w-0">

          {/* Header card */}
          <div className="rounded-2xl border border-white/8 p-8 mb-8 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(13,24,40,0.9) 0%, rgba(10,19,35,0.9) 100%)' }}>
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.06) 0%, transparent 70%)' }} />
            <div className="relative">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#00D4FF]/25 bg-[#00D4FF]/8 text-[#00D4FF] text-xs font-semibold">
                  <FileText className="w-3 h-3" />
                  Legal Document · v{VERSION}
                </span>
              </div>
              <h1 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: 'Syne, sans-serif' }}>
                Terms of Service
                <span className="text-[#00D4FF]"> &amp; </span>
                Privacy Policy
              </h1>
              <p className="text-[#475569] text-sm mb-5">
                Last updated: <span className="text-[#64748B] font-medium">{LAST_UPDATED}</span> · Effective immediately upon account creation.
              </p>
              <Callout type="warning">
                <strong>Important:</strong> QuantTrade AI is a financial data and analysis platform. It does not provide investment advice, brokerage services, or custodial accounts. Nothing on this platform constitutes a recommendation to buy, sell, or hold any security.
              </Callout>
            </div>
          </div>

          {/* Content sections */}
          <div className="rounded-2xl border border-white/6 overflow-hidden" style={{ background: 'rgba(10,16,28,0.7)' }}>
            <div className="p-8">

              {/* 1. Overview */}
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

              {/* 2. Eligibility */}
              <SectionHeading {...SECTIONS[1]} />
              <P>
                To use QuantTrade AI, you must be at least 18 years of age (or the age of majority in your jurisdiction, whichever is higher). By using the Platform, you represent that you meet these eligibility requirements.
              </P>
              <P>
                The Platform is not available to persons who have been previously suspended or removed from the Platform, or in jurisdictions where the Platform is prohibited by law.
              </P>

              <HR />

              {/* 3. Not Investment Advice */}
              <SectionHeading {...SECTIONS[2]} />
              <Callout type="warning">
                QuantTrade AI IS NOT A REGISTERED INVESTMENT ADVISER, BROKER-DEALER, OR FINANCIAL PLANNER under the Investment Advisers Act of 1940, the Securities Exchange Act of 1934, or any applicable state or foreign law.
              </Callout>
              <P>
                All information, analyses, AI-generated insights, charts, backtests, research, and content provided through the Platform are for <strong className="text-white/80">informational and educational purposes only</strong>. They do not constitute:
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

              {/* 4. Risk Disclosure */}
              <SectionHeading {...SECTIONS[3]} />
              <Callout type="warning">
                Trading securities, derivatives, cryptocurrencies, and other financial instruments involves significant risk of loss. You should only trade with capital you can afford to lose entirely.
              </Callout>
              <UL>
                <LI><strong className="text-white/80">Market Risk:</strong> Securities prices can fluctuate dramatically due to market conditions, economic events, and geopolitical factors.</LI>
                <LI><strong className="text-white/80">Liquidity Risk:</strong> Securities may become difficult or impossible to sell at favorable prices.</LI>
                <LI><strong className="text-white/80">Algorithm Risk:</strong> AI-generated analyses may contain errors, biases, or may not reflect current market conditions.</LI>
                <LI><strong className="text-white/80">Data Accuracy Risk:</strong> Market data may be delayed, inaccurate, or subject to errors from third-party providers.</LI>
                <LI><strong className="text-white/80">Technology Risk:</strong> Platform outages or API failures may prevent timely access.</LI>
                <LI><strong className="text-white/80">Regulatory Risk:</strong> Changes in securities regulation may impact trading strategies.</LI>
              </UL>

              <HR />

              {/* 5. Accounts */}
              <SectionHeading {...SECTIONS[4]} />
              <P>
                You must provide accurate, current, and complete information when creating an account. You are responsible for maintaining the confidentiality of your login credentials and for all activities under your account.
              </P>
              <UL>
                <LI>You may not share your account credentials with any third party.</LI>
                <LI>You must notify us immediately at security@quanttrade.us if you suspect unauthorized access.</LI>
                <LI>One account per individual is permitted. Multiple accounts to circumvent restrictions are prohibited.</LI>
                <LI>We reserve the right to suspend or terminate accounts that violate these Terms.</LI>
              </UL>

              <HR />

              {/* 6. Subscriptions */}
              <SectionHeading {...SECTIONS[5]} />
              <P>
                QuantTrade AI offers both free and paid subscription tiers. Paid subscriptions are billed in advance on a monthly or annual basis.
              </P>
              <UL>
                <LI>Subscription fees are non-refundable except as required by applicable law.</LI>
                <LI>We may change subscription fees with 30 days' notice to your registered email.</LI>
                <LI>You may cancel your subscription at any time; cancellation takes effect at period end.</LI>
                <LI>Downgrading may result in loss of access to certain features and data.</LI>
              </UL>

              <HR />

              {/* 7. Data */}
              <SectionHeading {...SECTIONS[6]} />
              <P>
                Market data, prices, financial information, and news displayed on the Platform are sourced from third-party data providers. This data may be delayed by 15 minutes or more unless you have a real-time data subscription.
              </P>
              <Callout type="info">
                Market data is provided "as is" without warranty of any kind. QuantTrade AI is not responsible for the accuracy, completeness, or timeliness of any data provided by third-party sources.
              </Callout>

              <HR />

              {/* 8. AI Services */}
              <SectionHeading {...SECTIONS[7]} />
              <P>
                The Platform employs artificial intelligence and machine learning to generate analyses, pattern recognition, risk assessments, and other insights. You acknowledge that:
              </P>
              <UL>
                <LI>AI-generated outputs are probabilistic estimates and may contain errors or hallucinations.</LI>
                <LI>AI analyses should be treated as one input among many, not as definitive guidance.</LI>
                <LI>AI models are trained on historical data and may not accurately predict future behavior.</LI>
                <LI>You should independently verify AI-generated insights before making any financial decision.</LI>
              </UL>

              <HR />

              {/* 9. IP */}
              <SectionHeading {...SECTIONS[8]} />
              <P>
                All content on the Platform, including text, graphics, logos, algorithms, software, AI models, and interfaces, is the exclusive property of QuantTrade Technologies, Inc. or its licensors.
              </P>
              <P>
                You are granted a limited, non-exclusive, non-transferable license to access and use the Platform for personal, non-commercial purposes only.
              </P>

              <HR />

              {/* 10. Privacy */}
              <SectionHeading {...SECTIONS[9]} />
              <P>
                We collect and process information about you in accordance with this Privacy Policy. By using the Platform, you consent to the collection, use, and disclosure of your information as described herein.
              </P>
              <P><strong className="text-white/80">Information We Collect:</strong></P>
              <UL>
                <LI>Account information: name, email address, username, and password (stored as a bcrypt hash)</LI>
                <LI>Usage data: pages visited, features used, session duration, and interaction logs</LI>
                <LI>Device and network data: IP address, browser type, operating system, and device identifiers</LI>
                <LI>Financial preferences: watchlists, saved searches, trading strategies, and preferences</LI>
                <LI>Payment information: processed securely through Stripe; we do not store full card numbers</LI>
              </UL>
              <P><strong className="text-white/80">How We Use Your Data:</strong></P>
              <UL>
                <LI>To provide, maintain, and improve the Platform</LI>
                <LI>To send security notifications including sign-in alerts</LI>
                <LI>To personalize your experience and improve AI model performance</LI>
                <LI>To process payments and manage subscription billing</LI>
                <LI>To detect and prevent fraud, abuse, and security incidents</LI>
              </UL>
              <Callout type="info">
                If you are located in the EEA or United Kingdom, you have additional rights under GDPR/UK GDPR including the right to access, rectify, erase, or port your personal data. Contact us at privacy@quanttrade.us.
              </Callout>

              <HR />

              {/* 11. Prohibited Use */}
              <SectionHeading {...SECTIONS[10]} />
              <UL>
                <LI>Market manipulation, wash trading, or any activity that violates securities laws</LI>
                <LI>Unauthorized scraping, harvesting, or automated extraction of Platform data</LI>
                <LI>Attempting to circumvent access controls, security measures, or subscription limits</LI>
                <LI>Uploading malware, viruses, or malicious code</LI>
                <LI>Impersonating another user, company, or entity</LI>
                <LI>Training or fine-tuning competing AI models using Platform data or outputs</LI>
                <LI>Reverse engineering, decompiling, or disassembling Platform software</LI>
              </UL>

              <HR />

              {/* 12. Liability */}
              <SectionHeading {...SECTIONS[11]} />
              <Callout type="warning">
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, QUANTTRADE TECHNOLOGIES, INC. SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, OR OTHER INTANGIBLE LOSSES.
              </Callout>
              <P>
                Our total liability shall not exceed the greater of (a) amounts you paid us in the 12 months preceding the claim, or (b) US$100. The Platform is provided "AS IS" and "AS AVAILABLE" without warranties of any kind.
              </P>

              <HR />

              {/* 13. Indemnification */}
              <SectionHeading {...SECTIONS[12]} />
              <P>
                You agree to indemnify, defend, and hold harmless QuantTrade Technologies, Inc. and its officers, directors, employees, agents, and licensors from and against any claims arising out of:
              </P>
              <UL>
                <LI>Your use of the Platform in violation of these Terms</LI>
                <LI>Your violation of any applicable law, regulation, or third-party right</LI>
                <LI>Any investment or financial decisions you make based on Platform content</LI>
              </UL>

              <HR />

              {/* 14. Dispute Resolution */}
              <SectionHeading {...SECTIONS[13]} />
              <P>
                <strong className="text-white/80">Binding Arbitration.</strong> Any dispute arising out of these Terms shall be resolved by binding arbitration administered by the AAA under its Commercial Arbitration Rules in Wilmington, Delaware, USA.
              </P>
              <P>
                <strong className="text-white/80">Class Action Waiver.</strong> You waive the right to participate in a class action lawsuit. You may only bring claims on an individual basis.
              </P>
              <P>
                <strong className="text-white/80">Opt-Out.</strong> You may opt out of this arbitration clause by sending written notice to legal@quanttrade.us within 30 days of first accepting these Terms.
              </P>

              <HR />

              {/* 15. Termination */}
              <SectionHeading {...SECTIONS[14]} />
              <P>
                We may suspend or terminate your access at any time, for any reason, with or without notice, including for violations of these Terms. You may terminate your account at any time by contacting quanttrade.us@icloud.com.
              </P>

              <HR />

              {/* 16. Changes */}
              <SectionHeading {...SECTIONS[15]} />
              <P>
                We reserve the right to modify these Terms at any time. We will notify registered users via email at least 14 days before material changes take effect.
              </P>

              <HR />

              {/* 17. Contact */}
              <SectionHeading {...SECTIONS[16]} />
              <div className="rounded-xl border border-white/8 overflow-hidden" style={{ background: 'rgba(13,24,40,0.6)' }}>
                {[
                  { label: 'General',   value: 'quanttrade.us@icloud.com',  mono: true },
                  { label: 'Privacy',   value: 'privacy@quanttrade.us',  mono: true },
                  { label: 'Legal',     value: 'legal@quanttrade.us',    mono: true },
                  { label: 'Security',  value: 'security@quanttrade.us', mono: true },
                  { label: 'Address',   value: 'QuantTrade Technologies, Inc., 1201 N Orange St, Wilmington, DE 19801, USA', mono: false },
                ].map(({ label, value, mono }, i, arr) => (
                  <div key={label} className={`flex items-start gap-4 px-5 py-4 ${i < arr.length - 1 ? 'border-b border-white/5' : ''}`}>
                    <span className="text-[10px] font-bold text-[#334155] uppercase tracking-widest w-16 shrink-0 mt-0.5">{label}</span>
                    <span className={`text-[#8B9BB4] text-sm ${mono ? 'font-mono text-[#00D4FF]/70' : ''}`}>{value}</span>
                  </div>
                ))}
              </div>

            </div>
          </div>

          {/* CTA */}
          <div className="mt-6 rounded-2xl border border-[#00D4FF]/15 p-6 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(0,212,255,0.06) 0%, rgba(10,124,255,0.04) 100%)' }}>
            <div className="absolute top-0 right-0 w-40 h-40 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 70%)' }} />
            <div className="relative flex items-start gap-4 mb-5">
              <div className="w-10 h-10 rounded-xl bg-[#00D4FF]/10 border border-[#00D4FF]/20 flex items-center justify-center shrink-0">
                <Shield className="w-5 h-5 text-[#00D4FF]" />
              </div>
              <div>
                <p className="text-white text-base font-semibold mb-1" style={{ fontFamily: 'Syne, sans-serif' }}>
                  Ready to trade smarter?
                </p>
                <p className="text-[#475569] text-sm leading-relaxed">
                  By creating an account you confirm you have read and agree to these Terms, our Privacy Policy, and Risk Disclosure. QuantTrade AI provides informational tools, not investment advice.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/auth"
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 px-5 rounded-xl font-bold text-sm transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #00D4FF, #0A7CFF)', color: '#060B12' }}
              >
                Back to Sign Up
              </Link>
              <Link
                href="/"
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 px-5 rounded-xl border border-white/10 text-[#8B9BB4] text-sm transition-all hover:border-white/20 hover:text-white"
              >
                Back to Home
              </Link>
            </div>
          </div>

          <p className="text-center text-[11px] text-[#1E293B] mt-6 pb-6">
            QuantTrade Technologies, Inc. · v{VERSION} · {LAST_UPDATED}
          </p>
        </div>
      </div>
    </div>
  )
}
