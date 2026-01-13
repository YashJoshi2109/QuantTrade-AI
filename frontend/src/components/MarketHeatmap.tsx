'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { SectorPerformance, StockPerformance } from '@/lib/api'

interface MarketHeatmapProps {
  sectors: SectorPerformance[]
  className?: string
}

function getColorForChange(change: number): string {
  if (change >= 3) return 'bg-green-600'
  if (change >= 2) return 'bg-green-500'
  if (change >= 1) return 'bg-green-500/80'
  if (change >= 0.5) return 'bg-green-500/60'
  if (change >= 0) return 'bg-green-500/40'
  if (change >= -0.5) return 'bg-red-500/40'
  if (change >= -1) return 'bg-red-500/60'
  if (change >= -2) return 'bg-red-500/80'
  if (change >= -3) return 'bg-red-500'
  return 'bg-red-600'
}

function getTextColorForChange(change: number): string {
  if (Math.abs(change) >= 1) return 'text-white'
  return 'text-white/80'
}

function StockTile({ stock }: { stock: StockPerformance }) {
  const bgColor = getColorForChange(stock.change_percent)
  const textColor = getTextColorForChange(stock.change_percent)
  
  return (
    <Link
      href={`/research?symbol=${stock.symbol}`}
      className={`${bgColor} p-2 flex flex-col items-center justify-center transition-all hover:brightness-110 hover:scale-[1.02] cursor-pointer border border-white/5`}
      title={`${stock.name}\n$${stock.price.toFixed(2)}\n${stock.change_percent >= 0 ? '+' : ''}${stock.change_percent.toFixed(2)}%`}
    >
      <span className={`font-bold text-xs ${textColor}`}>{stock.symbol}</span>
      <span className={`text-[10px] ${textColor} font-mono`}>
        {stock.change_percent >= 0 ? '+' : ''}{stock.change_percent.toFixed(2)}%
      </span>
    </Link>
  )
}

export default function MarketHeatmap({ sectors, className = '' }: MarketHeatmapProps) {
  const [selectedSector, setSelectedSector] = useState<string | null>(null)
  
  // Filter sectors based on selection
  const displaySectors = useMemo(() => {
    if (selectedSector) {
      return sectors.filter(s => s.sector === selectedSector)
    }
    return sectors
  }, [sectors, selectedSector])
  
  // Calculate total market stats
  const marketStats = useMemo(() => {
    let gainers = 0
    let losers = 0
    let unchanged = 0
    
    sectors.forEach(sector => {
      sector.stocks.forEach(stock => {
        if (stock.change_percent > 0.1) gainers++
        else if (stock.change_percent < -0.1) losers++
        else unchanged++
      })
    })
    
    return { gainers, losers, unchanged, total: gainers + losers + unchanged }
  }, [sectors])

  return (
    <div className={`${className}`}>
      {/* Legend & Stats */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
        {/* Sector Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSelectedSector(null)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
              !selectedSector 
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' 
                : 'text-slate-400 hover:bg-slate-800/50'
            }`}
          >
            All Sectors
          </button>
          {sectors.slice(0, 6).map(sector => (
            <button
              key={sector.sector}
              onClick={() => setSelectedSector(selectedSector === sector.sector ? null : sector.sector)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                selectedSector === sector.sector 
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' 
                  : 'text-slate-400 hover:bg-slate-800/50'
              }`}
            >
              {sector.sector}
            </button>
          ))}
        </div>
        
        {/* Stats */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-green-500 rounded-sm" />
            <span className="text-green-400">{marketStats.gainers} Up</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-red-500 rounded-sm" />
            <span className="text-red-400">{marketStats.losers} Down</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-slate-500 rounded-sm" />
            <span className="text-slate-400">{marketStats.unchanged} Flat</span>
          </div>
        </div>
      </div>
      
      {/* Color Legend */}
      <div className="flex items-center justify-center gap-1 mb-4">
        <span className="text-[10px] text-slate-500">-3%</span>
        <div className="flex">
          <div className="w-6 h-3 bg-red-600" />
          <div className="w-6 h-3 bg-red-500" />
          <div className="w-6 h-3 bg-red-500/80" />
          <div className="w-6 h-3 bg-red-500/60" />
          <div className="w-6 h-3 bg-red-500/40" />
          <div className="w-6 h-3 bg-slate-600" />
          <div className="w-6 h-3 bg-green-500/40" />
          <div className="w-6 h-3 bg-green-500/60" />
          <div className="w-6 h-3 bg-green-500/80" />
          <div className="w-6 h-3 bg-green-500" />
          <div className="w-6 h-3 bg-green-600" />
        </div>
        <span className="text-[10px] text-slate-500">+3%</span>
      </div>
      
      {/* Heatmap Grid */}
      <div className="space-y-4">
        {displaySectors.map(sector => (
          <div key={sector.sector} className="border border-slate-700/50 rounded-lg overflow-hidden">
            {/* Sector Header */}
            <div className={`px-4 py-2 flex items-center justify-between ${
              sector.change_percent >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'
            }`}>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-sm">{sector.sector.toUpperCase()}</span>
                <span className="text-xs text-slate-400">({sector.stocks.length} stocks)</span>
              </div>
              <span className={`text-sm font-bold font-mono ${
                sector.change_percent >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {sector.change_percent >= 0 ? '+' : ''}{sector.change_percent.toFixed(2)}%
              </span>
            </div>
            
            {/* Stocks Grid */}
            <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 xl:grid-cols-15 gap-px bg-slate-900 p-px">
              {sector.stocks.map(stock => (
                <StockTile key={stock.symbol} stock={stock} />
              ))}
            </div>
          </div>
        ))}
      </div>
      
      {/* Instructions */}
      <div className="mt-4 text-center text-[10px] text-slate-500">
        Click on any stock to view detailed analysis • Hover for quick info
      </div>
    </div>
  )
}
