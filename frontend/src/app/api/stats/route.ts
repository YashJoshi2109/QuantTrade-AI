import { NextResponse } from 'next/server'
import { getFmpUsage } from '@/lib/fmp-usage'

export async function GET() {
  const fmp = getFmpUsage()
  return NextResponse.json({
    fmp: {
      used: fmp.used,
      limit: fmp.limit,
      date: fmp.date,
      percent: Math.round((fmp.used / fmp.limit) * 100),
    },
  })
}
