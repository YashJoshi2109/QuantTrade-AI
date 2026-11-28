'use client'

/**
 * Strategy Lab: rule-based backtests (builder, results, trades, robustness).
 * Desktop and mobile share state helpers (useBacktestLab), building blocks
 * (LabParts) and numbers/copy (lib/backtestLab). The named-strategy tools
 * (compare, scanner, risk) live at /backtest/classic.
 */
import MobileLayout from '@/components/layout/MobileLayout'
import LabDesktop from '@/components/backtest/lab/LabDesktop'
import LabMobile from '@/components/backtest/lab/LabMobile'

export default function BacktestPage() {
  return (
    <>
      <div className="hidden md:block">
        <LabDesktop />
      </div>
      <div className="md:hidden">
        <MobileLayout>
          <LabMobile />
        </MobileLayout>
      </div>
    </>
  )
}
