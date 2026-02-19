'use client'

import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import type { Message } from '../ChatWindow'
import type { StockAnalysisData, ComparisonData, ScreenerData, SectorData } from '../types'

const StockOverviewCard = dynamic(() => import('./StockOverviewCard'), { ssr: false })
const ChartSnapshot = dynamic(() => import('./ChartSnapshot'), { ssr: false })
const InsightPanel = dynamic(() => import('./InsightPanel'), { ssr: false })
const ComparisonView = dynamic(() => import('./ComparisonView'), { ssr: false })
const ScreenerTable = dynamic(() => import('./ScreenerTable'), { ssr: false })
const SectorHeatmapChat = dynamic(() => import('./SectorHeatmapChat'), { ssr: false })

interface Props {
  message: Message
}

export default function AIMessageContainer({ message }: Props) {
  const { responseType, structuredData } = message
  if (!responseType || responseType === 'text' || !structuredData) return null

  switch (responseType) {
    case 'stock_analysis': {
      const data = structuredData as StockAnalysisData
      return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="space-y-2 w-full max-w-full overflow-hidden"
        >
          <StockOverviewCard data={data} />
          <ChartSnapshot symbol={data.symbol} data={data} />
          <InsightPanel data={data} />
        </motion.div>
      )
    }

    case 'comparison': {
      const data = structuredData as ComparisonData
      return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-full overflow-hidden"
        >
          <ComparisonView data={data} />
        </motion.div>
      )
    }

    case 'screener': {
      const data = structuredData as ScreenerData
      return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-full overflow-hidden"
        >
          <ScreenerTable data={data} />
        </motion.div>
      )
    }

    case 'sector': {
      const data = structuredData as SectorData
      return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-full overflow-hidden"
        >
          <SectorHeatmapChat data={data} />
        </motion.div>
      )
    }

    default:
      return null
  }
}
