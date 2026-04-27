'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, RefreshCw, Download, X } from 'lucide-react'
import { generateGameAsset } from '@/lib/fal'

type AssetType = 'character' | 'building' | 'scene' | 'item'

const PRESETS: Record<AssetType, Array<{ label: string; name: string }>> = {
  character: [
    { label: 'Apprentice', name: 'young apprentice merchant in simple medieval tunic' },
    { label: 'Scholar', name: 'wise scholar with scrolls and books' },
    { label: 'Knight', name: 'armored knight with gleaming sword' },
    { label: 'Merchant', name: 'wealthy merchant with coin purse and trade goods' },
    { label: 'Sage', name: 'mystical sage with glowing staff' },
  ],
  building: [
    { label: 'Market Stall', name: 'busy market stall with vegetables and goods' },
    { label: 'Guild Hall', name: 'grand guild hall with banners and stone archway' },
    { label: 'Bank', name: 'medieval bank with iron vault door and gold coins' },
    { label: 'Tavern', name: 'warm cozy tavern with barrels and fireplace' },
    { label: 'Library', name: 'ancient library tower filled with scrolls and books' },
  ],
  scene: [
    { label: 'Ashmarket', name: 'bustling medieval market square at golden hour' },
    { label: 'Night Market', name: 'moonlit night market with lanterns and shadows' },
    { label: 'Harvest Festival', name: 'colorful harvest festival with banners and celebrations' },
    { label: 'Stormy Day', name: 'dark stormy market day with wind and rain' },
  ],
  item: [
    { label: 'Gold Coin', name: 'gleaming gold coin with royal emblem' },
    { label: 'Merchant Ledger', name: 'ancient merchant ledger book with quill' },
    { label: 'Savings Chest', name: 'ornate wooden chest overflowing with gold coins' },
    { label: 'Trade Seal', name: 'magical glowing trade seal stamp' },
  ],
}

const ASSET_ICONS: Record<AssetType, string> = {
  character: '🧙',
  building: '🏰',
  scene: '🌅',
  item: '🪙',
}

interface AssetGeneratorProps {
  defaultType?: AssetType
  compact?: boolean
}

export function AssetGenerator({ defaultType = 'character', compact = false }: AssetGeneratorProps) {
  const [assetType, setAssetType] = useState<AssetType>(defaultType)
  const [customName, setCustomName] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [currentName, setCurrentName] = useState('')

  async function generate(name: string) {
    if (!name.trim()) return
    setGenerating(true)
    setError(null)
    setCurrentName(name)
    const url = await generateGameAsset(assetType, name)
    setGenerating(false)
    if (url) {
      setImageUrl(url)
    } else {
      setError('Generation failed. Please try again.')
    }
  }

  return (
    <div className={`rounded-2xl border border-amber-500/20 bg-[#080810] overflow-hidden ${compact ? '' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-amber-500/15">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span className="font-bold text-amber-300 text-sm" style={{ fontFamily: 'Syne, serif' }}>
            AI Asset Generator
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 font-bold">
            fal.ai
          </span>
        </div>
        {imageUrl && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => generate(currentName)} disabled={generating} className="p-1.5 rounded-lg text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10 transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
            </button>
            <a href={imageUrl} download={`qlife-${assetType}.jpg`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10 transition-colors">
              <Download className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Asset type tabs */}
        <div className="flex gap-1 bg-white/3 rounded-xl p-1">
          {(Object.keys(PRESETS) as AssetType[]).map((type) => (
            <button
              key={type}
              onClick={() => { setAssetType(type); setImageUrl(null); setError(null) }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                assetType === type
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              <span>{ASSET_ICONS[type]}</span>
              {!compact && <span className="capitalize">{type}</span>}
            </button>
          ))}
        </div>

        {/* Presets */}
        <div>
          <div className="text-[10px] text-amber-400/50 uppercase tracking-widest font-semibold mb-2">Quick Generate</div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS[assetType].map((preset) => (
              <button
                key={preset.label}
                onClick={() => generate(preset.name)}
                disabled={generating}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-line-default bg-white/3 text-white/60 hover:border-amber-500/30 hover:text-amber-300 hover:bg-amber-500/8 transition-all disabled:opacity-40"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom prompt */}
        <div className="flex gap-2">
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && generate(customName)}
            placeholder={`Custom ${assetType} description…`}
            className="flex-1 px-3 py-2 bg-white/3 border border-line-subtle rounded-xl text-sm text-white placeholder-white/25 focus:outline-none focus:border-amber-500/30 transition-all"
          />
          <button
            onClick={() => generate(customName)}
            disabled={generating || !customName.trim()}
            className="px-4 py-2 rounded-xl bg-amber-600 text-[#060B12] font-bold text-sm hover:bg-amber-500 transition-colors disabled:opacity-40"
          >
            {generating ? '…' : '⚔️'}
          </button>
        </div>

        {/* Image output */}
        <AnimatePresence mode="wait">
          {generating && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-10 gap-3"
            >
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 border-2 border-amber-500/20 border-t-amber-400 rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center text-xl">⚔️</div>
              </div>
              <p className="text-amber-400/60 text-xs">Forging asset with fal.ai Flux…</p>
            </motion.div>
          )}

          {imageUrl && !generating && (
            <motion.div
              key="image"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative"
            >
              <img
                src={imageUrl}
                alt={`Generated ${assetType}`}
                className="w-full rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
                style={{
                  aspectRatio: assetType === 'character' || assetType === 'item' ? '3/4' : '16/9',
                }}
                onClick={() => setExpanded(true)}
              />
              <div className="absolute bottom-2 right-2 text-[9px] text-white/30 bg-black/40 px-2 py-1 rounded backdrop-blur-sm">
                fal.ai Flux Dev
              </div>
            </motion.div>
          )}

          {error && !generating && (
            <motion.p
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 text-center"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {expanded && imageUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
            onClick={() => setExpanded(false)}
          >
            <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20" onClick={() => setExpanded(false)}>
              <X className="w-5 h-5" />
            </button>
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              src={imageUrl}
              alt="Generated asset"
              className="max-w-2xl w-full rounded-2xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
