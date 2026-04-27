'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Download, RefreshCw, X } from 'lucide-react'
import { generateStockVisual } from '@/lib/fal'

interface StockVisualProps {
  symbol: string
  companyName: string
  sentiment?: 'bullish' | 'bearish' | 'neutral'
}

export default function StockVisual({ symbol, companyName, sentiment = 'neutral' }: StockVisualProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  async function generate() {
    setLoading(true)
    setError(null)
    const url = await generateStockVisual(symbol, companyName, sentiment)
    setLoading(false)
    if (url) {
      setImageUrl(url)
    } else {
      setError('Generation failed — check FAL_API_KEY or try again')
    }
  }

  return (
    <div className="rounded-2xl border border-line-subtle bg-surface-base/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line-subtle/50">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-bold text-white">AI Visual</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 font-bold">
            fal.ai
          </span>
        </div>
        <div className="flex items-center gap-2">
          {imageUrl && (
            <>
              <button
                onClick={() => setExpanded(true)}
                className="text-xs text-fg-muted hover:text-fg-primary transition-colors px-2 py-1 rounded-lg hover:bg-surface-raised"
              >
                Expand
              </button>
              <a
                href={imageUrl}
                download={`${symbol}-visual.jpg`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-lg text-fg-muted hover:text-fg-primary hover:bg-surface-raised transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={generate}
                disabled={loading}
                className="p-1.5 rounded-lg text-fg-muted hover:text-cyan-400 hover:bg-surface-raised transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <AnimatePresence mode="wait">
          {!imageUrl && !loading && (
            <motion.div
              key="cta"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-8 gap-4"
            >
              <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <Sparkles className="w-7 h-7 text-cyan-400" />
              </div>
              <div className="text-center">
                <p className="text-white font-semibold text-sm mb-1">Generate AI visual for {symbol}</p>
                <p className="text-fg-muted text-xs">AI-generated financial illustration using fal.ai Flux</p>
              </div>
              {error && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 text-center">
                  {error}
                </p>
              )}
              <button
                onClick={generate}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 text-white text-sm font-bold hover:from-cyan-400 hover:to-sky-400 transition-all shadow-lg shadow-cyan-500/20"
              >
                <Sparkles className="w-4 h-4" />
                Generate Visual
              </button>
            </motion.div>
          )}

          {loading && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-10 gap-4"
            >
              {/* Animated rings */}
              <div className="relative w-14 h-14">
                <div className="absolute inset-0 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
                <div className="absolute inset-2 border border-sky-500/20 border-t-sky-400 rounded-full animate-spin" style={{ animationDuration: '1.5s', animationDirection: 'reverse' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-cyan-400" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-white text-sm font-semibold mb-1">Generating visual…</p>
                <p className="text-fg-muted text-xs">fal.ai Flux · usually under 5 seconds</p>
              </div>
            </motion.div>
          )}

          {imageUrl && !loading && (
            <motion.div
              key="image"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative"
            >
              <img
                src={imageUrl}
                alt={`AI visual for ${symbol}`}
                className="w-full rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
                style={{ aspectRatio: '1200/630' }}
                onClick={() => setExpanded(true)}
              />
              <div className="absolute bottom-2 right-2 text-[10px] text-white/40 bg-black/40 px-2 py-1 rounded-lg backdrop-blur-sm">
                Generated by fal.ai Flux
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Expanded lightbox */}
      <AnimatePresence>
        {expanded && imageUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
            onClick={() => setExpanded(false)}
          >
            <button
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
              onClick={() => setExpanded(false)}
            >
              <X className="w-5 h-5" />
            </button>
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              src={imageUrl}
              alt={`AI visual for ${symbol}`}
              className="max-w-4xl w-full rounded-2xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
