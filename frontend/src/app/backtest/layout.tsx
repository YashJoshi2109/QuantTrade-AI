import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Backtest — Strategy Engine | QuantTrade AI',
  description:
    'Rule-based strategy backtesting engine. Sharpe ratio, max drawdown, Monte Carlo simulations, and trade logs. Test any trading strategy against historical OHLCV data from NYSE, NASDAQ, and AMEX.',
  keywords: [
    'strategy backtesting', 'trading backtester', 'sharpe ratio calculator',
    'monte carlo simulation', 'algorithmic trading backtest', 'quantitative strategy testing',
  ],
  openGraph: {
    title: 'Strategy Backtester — QuantTrade AI',
    description: 'Test trading strategies with Sharpe ratio, max drawdown, Monte Carlo simulations, and trade logs.',
    url: 'https://quanttrade.us/backtest',
  },
  alternates: { canonical: 'https://quanttrade.us/backtest' },
}

export default function BacktestLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
