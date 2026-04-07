'use client'

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { ChapterStatus } from '@/lib/student-chapters'

// ─── Isometric math ──────────────────────────────────────────────────────────
const ORIGIN = { x: 480, y: 110 }
const TW = 80  // tile width
const TH = 40  // tile height

function gridToScreen(col: number, row: number) {
  return {
    x: ORIGIN.x + (col - row) * (TW / 2),
    y: ORIGIN.y + (col + row) * (TH / 2),
  }
}

// ─── IsoBox renderer ─────────────────────────────────────────────────────────
interface IsoBoxProps {
  cx: number
  cy: number
  w: number   // half-width of tile
  d: number   // half-depth of tile
  h: number   // building height
  top: string
  left: string
  right: string
  opacity?: number
}

function IsoBox({ cx, cy, w, d, h, top, left, right, opacity = 1 }: IsoBoxProps) {
  const topPts    = `${cx},${cy - d} ${cx + w},${cy} ${cx},${cy + d} ${cx - w},${cy}`
  const leftPts   = `${cx - w},${cy} ${cx},${cy + d} ${cx},${cy + d + h} ${cx - w},${cy + h}`
  const rightPts  = `${cx + w},${cy} ${cx},${cy + d} ${cx},${cy + d + h} ${cx + w},${cy + h}`
  return (
    <g opacity={opacity}>
      <polygon points={rightPts} fill={right} />
      <polygon points={leftPts}  fill={left}  />
      <polygon points={topPts}   fill={top}   />
    </g>
  )
}

// ─── Building definitions ─────────────────────────────────────────────────────
interface Building {
  key: string
  name: string
  emoji: string
  col: number
  row: number
  w: number    // half tile-width
  d: number    // half tile-depth
  h: number    // height
  top: string
  left: string
  right: string
  chapterNum?: number
  npc?: string
  isLocked?: boolean
}

const BUILDINGS: Building[] = [
  // Harbor/Dock (back-left)
  {
    key: 'harbor',
    name: 'Ashmarket Docks',
    emoji: '⚓',
    col: 0, row: 1,
    w: 40, d: 20, h: 18,
    top: '#1B6CA8', left: '#144F7C', right: '#2A82C5',
    chapterNum: 1,
    npc: 'Merchant Rafiq',
  },
  // Spice boat (even further back)
  {
    key: 'boat',
    name: 'Spice Merchant Boat',
    emoji: '⛵',
    col: -1, row: 1,
    w: 35, d: 18, h: 30,
    top: '#8B5E3C', left: '#6A4529', right: '#A07044',
    chapterNum: 1,
    npc: 'Merchant Rafiq',
  },
  // Market Stall A
  {
    key: 'market_a',
    name: "Rafiq's Spice Stall",
    emoji: '🌿',
    col: 2, row: 0,
    w: 38, d: 18, h: 42,
    top: '#D4604A', left: '#A84538', right: '#C05545',
    chapterNum: 1,
    npc: 'Merchant Rafiq',
  },
  // Market Stall B
  {
    key: 'market_b',
    name: 'Cloth Merchant',
    emoji: '🪡',
    col: 3, row: 0,
    w: 36, d: 18, h: 40,
    top: '#8B4CA5', left: '#6A3A80', right: '#9D5EB8',
    chapterNum: 2,
  },
  // Market Stall C
  {
    key: 'market_c',
    name: 'Food Vendor',
    emoji: '🥖',
    col: 4, row: 0,
    w: 36, d: 18, h: 38,
    top: '#C27B2A', left: '#9A6020', right: '#D4903A',
    chapterNum: 2,
  },
  // Market Stall D (general market)
  {
    key: 'market',
    name: 'Market Centre',
    emoji: '🏪',
    col: 5, row: 0,
    w: 40, d: 20, h: 48,
    top: '#C8533A', left: '#A04030', right: '#D96048',
    chapterNum: 7,
    npc: 'Suspicious Trader',
  },
  // Town Square
  {
    key: 'town_square',
    name: 'Town Square',
    emoji: '🏛️',
    col: 3, row: 2,
    w: 44, d: 22, h: 28,
    top: '#B89A6E', left: '#8A7450', right: '#C4A87A',
    chapterNum: 5,
    npc: 'Stable Boy Finn',
  },
  // Family Home
  {
    key: 'home',
    name: 'Family Home',
    emoji: '🏠',
    col: 1, row: 3,
    w: 38, d: 20, h: 50,
    top: '#9B6A3A', left: '#7A5228', right: '#B07A48',
    chapterNum: 3,
    npc: 'Father Aldric',
  },
  // Shady Alley
  {
    key: 'shady_alley',
    name: 'Shady Alley',
    emoji: '🕶️',
    col: 0, row: 4,
    w: 28, d: 14, h: 55,
    top: '#3A2A4A', left: '#2A1E38', right: '#4A3560',
    chapterNum: 6,
    npc: 'Street Peddler Varn',
  },
  // Guild Vault (Bank)
  {
    key: 'guild_vault',
    name: 'Guild Vault',
    emoji: '🏦',
    col: 5, row: 2,
    w: 42, d: 22, h: 62,
    top: '#3A6BA8', left: '#2A5080', right: '#4A7EC0',
    chapterNum: 4,
    npc: 'Master Elowen',
  },
  // Blacksmith
  {
    key: 'blacksmith',
    name: 'Blacksmith Forge',
    emoji: '⚒️',
    col: 2, row: 4,
    w: 34, d: 18, h: 46,
    top: '#4A4040', left: '#352D2D', right: '#5C5050',
  },
  // Guild Hall (School)
  {
    key: 'guild_hall',
    name: 'Guild Hall',
    emoji: '📚',
    col: 4, row: 3,
    w: 40, d: 20, h: 56,
    top: '#3A7A50', left: '#2B5C3C', right: '#4A9060',
    chapterNum: 9,
    npc: 'Guild Tutor Sera',
  },
  // Grain Mill
  {
    key: 'grain_mill',
    name: 'Grain Mill',
    emoji: '⚙️',
    col: 6, row: 4,
    w: 38, d: 20, h: 58,
    top: '#8B6A3A', left: '#6A5028', right: '#A07A48',
    chapterNum: 8,
    npc: 'Miller Oswin',
  },
  // Trade Academy (locked until ch10)
  {
    key: 'academy',
    name: 'Trade Academy',
    emoji: '🎓',
    col: 7, row: 2,
    w: 48, d: 24, h: 80,
    top: '#C9A84C', left: '#9A8030', right: '#DEC060',
    chapterNum: 10,
    npc: 'Headmaster Aldus',
    isLocked: true,
  },
]

// Sort back-to-front (painter's algorithm)
const SORTED_BUILDINGS = [...BUILDINGS].sort((a, b) => (a.col + a.row) - (b.col + b.row))

// ─── Ground tile grid ──────────────────────────────────────────────────────
function GroundTiles() {
  const tiles: React.ReactNode[] = []
  for (let col = -1; col <= 9; col++) {
    for (let row = -1; row <= 7; row++) {
      const { x, y } = gridToScreen(col, row)
      const isWater = col <= 0 && row <= 1
      const shade = (col + row) % 2 === 0
      const fill = isWater
        ? (shade ? '#1B5C9A' : '#1A5590')
        : (shade ? '#C4A87A' : '#B89A6E')
      const pts = `${x},${y - TH / 2} ${x + TW / 2},${y} ${x},${y + TH / 2} ${x - TW / 2},${y}`
      tiles.push(<polygon key={`${col}_${row}`} points={pts} fill={fill} stroke="#00000008" strokeWidth={0.5} />)
    }
  }
  return <>{tiles}</>
}

// ─── Tree decoration ─────────────────────────────────────────────────────────
function Tree({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <IsoBox cx={cx} cy={cy} w={8} d={4} h={12} top="#5A8A3A" left="#3A6020" right="#6A9A48" />
      <ellipse cx={cx} cy={cy - 18} rx={12} ry={8} fill="#4A7A30" />
      <ellipse cx={cx} cy={cy - 22} rx={9} ry={6} fill="#5A9040" />
    </g>
  )
}

// ─── Well decoration ─────────────────────────────────────────────────────────
function Well({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <IsoBox cx={cx} cy={cy} w={10} d={5} h={14} top="#A0907A" left="#7A6A58" right="#B8A888" />
      <line x1={cx - 6} y1={cy - 14} x2={cx + 6} y2={cy - 14} stroke="#6A5A48" strokeWidth={2} />
      <line x1={cx} y1={cy - 14} x2={cx} y2={cy - 20} stroke="#6A5A48" strokeWidth={1.5} />
    </g>
  )
}

// ─── Status indicator ─────────────────────────────────────────────────────────
interface BuildingIndicatorProps {
  cx: number
  cy: number
  h: number
  status: ChapterStatus
  chapterNum?: number
  isHovered: boolean
}

function BuildingIndicator({ cx, cy, h, status, chapterNum, isHovered }: BuildingIndicatorProps) {
  if (!chapterNum) return null
  const labelY = cy - h - 24

  const colors: Record<ChapterStatus, { bg: string; text: string; label: string }> = {
    locked:    { bg: '#4A4A6A', text: '#9090C0', label: '🔒' },
    available: { bg: '#C9A84C', text: '#1A1A0A', label: `Ch.${chapterNum}` },
    active:    { bg: '#00D4FF', text: '#060B12', label: `▶ Ch.${chapterNum}` },
    completed: { bg: '#00E5A0', text: '#0A1F18', label: '✓' },
  }

  const c = colors[status]

  return (
    <g>
      {/* Connecting line */}
      <line x1={cx} y1={labelY + 14} x2={cx} y2={cy - h} stroke={c.bg} strokeWidth={1} strokeDasharray="3 2" opacity={0.6} />

      {/* Badge */}
      <rect x={cx - 20} y={labelY - 8} width={40} height={16} rx={8} fill={c.bg} opacity={isHovered ? 1 : 0.85} />
      <text x={cx} y={labelY + 4} textAnchor="middle" fontSize={9} fontWeight="700" fill={c.text}
        style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        {c.label}
      </text>

      {/* Pulse ring for available */}
      {status === 'available' && isHovered && (
        <circle cx={cx} cy={cy - h / 2} r={24} fill="none" stroke="#C9A84C" strokeWidth={2} opacity={0.4} />
      )}
    </g>
  )
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface IsometricTownProps {
  completedChapters: string[]
  currentChapterId: string | null
  onBuildingClick: (buildingKey: string, chapterNum?: number) => void
  className?: string
}

// ─── Main component ───────────────────────────────────────────────────────────
export function IsometricTown({
  completedChapters,
  currentChapterId,
  onBuildingClick,
  className = '',
}: IsometricTownProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  function getBuildingStatus(building: Building): ChapterStatus {
    if (!building.chapterNum) return 'locked'
    const chId = `ch${building.chapterNum}`
    if (completedChapters.includes(chId)) return 'completed'
    if (currentChapterId === chId) return 'active'

    // Is it unlocked? First chapter always available, rest need previous done
    if (building.chapterNum === 1) return 'available'
    const prevId = `ch${building.chapterNum - 1}`
    if (completedChapters.includes(prevId)) return 'available'
    return 'locked'
  }

  return (
    <div className={`relative ${className}`} style={{ userSelect: 'none' }}>
      <svg
        viewBox="0 0 1000 600"
        width="100%"
        height="100%"
        style={{ maxHeight: '100%' }}
      >
        <defs>
          {/* Sky gradient */}
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0A1A35" />
            <stop offset="60%" stopColor="#1A3A6A" />
            <stop offset="100%" stopColor="#2A4A7A" />
          </linearGradient>
          {/* Glow filter */}
          <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Amber glow */}
          <filter id="amber-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feColorMatrix type="matrix" values="1 0.5 0 0 0  0.6 0.3 0 0 0  0 0 0 0 0  0 0 0 0.8 0" in="blur" result="amber" />
            <feMerge><feMergeNode in="amber" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Water shimmer */}
          <linearGradient id="water" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1B5C9A" />
            <stop offset="50%" stopColor="#2A70B8" />
            <stop offset="100%" stopColor="#1B5C9A" />
          </linearGradient>
          {/* Vault shimmer */}
          <linearGradient id="vault-top" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5A8AC0" />
            <stop offset="100%" stopColor="#3A6BA8" />
          </linearGradient>
        </defs>

        {/* ── Sky backdrop ── */}
        <rect width="1000" height="600" fill="url(#sky)" />

        {/* Distant mountains */}
        <polygon points="0,200 120,80 240,160 360,60 500,140 650,50 800,120 900,70 1000,110 1000,220 0,220"
          fill="#1A2A4A" opacity={0.7} />
        <polygon points="0,220 100,120 200,180 320,100 440,160 560,90 700,150 840,100 1000,140 1000,240 0,240"
          fill="#1F3255" opacity={0.8} />

        {/* Moon */}
        <circle cx={820} cy={55} r={22} fill="#E8D898" opacity={0.9} />
        <circle cx={835} cy={48} r={18} fill="#1A3A6A" />

        {/* Stars */}
        {[[100,30],[200,15],[350,45],[450,20],[600,35],[720,18],[870,40],[950,25],[50,60],[280,55]].map(([sx, sy], i) => (
          <circle key={i} cx={sx} cy={sy} r={1.2} fill="#E8D8A8" opacity={0.8} />
        ))}

        {/* Distant castle silhouette */}
        <g opacity={0.4} fill="#0D1F40">
          <rect x={580} y={100} width={8} height={40} />
          <rect x={605} y={90} width={10} height={50} />
          <rect x={630} y={105} width={8} height={35} />
          <rect x={577} y={95} width={14} height={8} />
          <rect x={603} y={85} width={16} height={8} />
          <rect x={628} y={100} width={12} height={8} />
        </g>

        {/* ── Ground plane ── */}
        <GroundTiles />

        {/* ── Water texture lines ── */}
        {[0, 1, 2, 3].map((i) => {
          const { x, y } = gridToScreen(-1 + i * 0.3, 0.5)
          return (
            <line key={i} x1={x - 20} y1={y + i * 5} x2={x + 30} y2={y + i * 5 + 8}
              stroke="#3A88C8" strokeWidth={0.8} opacity={0.4} />
          )
        })}

        {/* ── Decorative trees ── */}
        {[
          [0, 3], [1, 5], [8, 5], [7, 6],
        ].map(([col, row], i) => {
          const { x, y } = gridToScreen(col, row)
          return <Tree key={i} cx={x} cy={y - 10} />
        })}

        {/* Well in town square */}
        {(() => { const { x, y } = gridToScreen(3, 3); return <Well cx={x + 20} cy={y - 16} /> })()}

        {/* ── Lamp posts ── */}
        {[
          [2, 2], [4, 2], [3, 4],
        ].map(([col, row], i) => {
          const { x, y } = gridToScreen(col, row)
          return (
            <g key={i}>
              <line x1={x} y1={y - 5} x2={x} y2={y - 35} stroke="#5A4A2A" strokeWidth={2} />
              <circle cx={x} cy={y - 38} r={5} fill="#FFD060" opacity={0.9} filter="url(#glow)" />
              <circle cx={x} cy={y - 38} r={10} fill="#FFD060" opacity={0.15} />
            </g>
          )
        })}

        {/* ── Torch flames at market ── */}
        {[
          [2, 0], [5, 0],
        ].map(([col, row], i) => {
          const { x, y } = gridToScreen(col, row)
          return (
            <g key={i} filter="url(#glow)">
              <ellipse cx={x - 30} cy={y - 52} rx={4} ry={6} fill="#FF8830" opacity={0.9} />
              <ellipse cx={x - 30} cy={y - 56} rx={2.5} ry={4} fill="#FFD060" opacity={0.8} />
            </g>
          )
        })}

        {/* ── Blacksmith smoke ── */}
        {(() => {
          const { x, y } = gridToScreen(2, 4)
          return (
            <g opacity={0.5}>
              <circle cx={x - 5} cy={y - 60} r={4} fill="#888" />
              <circle cx={x - 8} cy={y - 68} r={5} fill="#777" />
              <circle cx={x - 4} cy={y - 76} r={6} fill="#666" />
            </g>
          )
        })()}

        {/* ── Buildings (sorted painter's order) ── */}
        {SORTED_BUILDINGS.map((b) => {
          const { x, y } = gridToScreen(b.col, b.row)
          const status = getBuildingStatus(b)
          const isHovered = hoveredKey === b.key
          const isLocked = status === 'locked'
          const isAvail = status === 'available'
          const isCompleted = status === 'completed'

          return (
            <g key={b.key}>
              {/* Building body */}
              <IsoBox
                cx={x} cy={y}
                w={b.w} d={b.d} h={b.h}
                top={isLocked ? '#3A3A4A' : b.top}
                left={isLocked ? '#2A2A3A' : b.left}
                right={isLocked ? '#4A4A5A' : b.right}
                opacity={isLocked ? 0.55 : 1}
              />

              {/* Roof decoration (top triangles for pointed roofs) */}
              {b.h > 50 && !isLocked && (
                <polygon
                  points={`${x},${y - b.d - b.h - 18} ${x + b.w},${y - b.h} ${x},${y - b.d - b.h - 2} ${x - b.w},${y - b.h}`}
                  fill={b.top}
                  opacity={0.9}
                />
              )}

              {/* Available glow */}
              {isAvail && (
                <g filter="url(#amber-glow)">
                  <polygon
                    points={`${x},${y - b.d} ${x + b.w},${y} ${x},${y + b.d} ${x - b.w},${y}`}
                    fill="none"
                    stroke="#C9A84C"
                    strokeWidth={2.5}
                    opacity={isHovered ? 0.9 : 0.5}
                  />
                </g>
              )}

              {/* Completed green glow */}
              {isCompleted && (
                <polygon
                  points={`${x},${y - b.d} ${x + b.w},${y} ${x},${y + b.d} ${x - b.w},${y}`}
                  fill="none"
                  stroke="#00E5A0"
                  strokeWidth={2}
                  opacity={0.6}
                />
              )}

              {/* Chapter badge */}
              <BuildingIndicator
                cx={x} cy={y}
                h={b.h}
                status={status}
                chapterNum={b.chapterNum}
                isHovered={isHovered}
              />

              {/* NPC indicator dot */}
              {b.npc && !isLocked && (
                <g>
                  <circle cx={x} cy={y - b.h - b.d + 4} r={8} fill={isAvail ? '#C9A84C' : '#4A8A6A'} opacity={0.9} />
                  <text x={x} y={y - b.h - b.d + 8} textAnchor="middle" fontSize={9}>
                    {b.emoji}
                  </text>
                </g>
              )}

              {/* Invisible clickable area */}
              {b.chapterNum && (
                <polygon
                  points={`${x},${y - b.d - b.h} ${x + b.w + 10},${y - b.h + b.d} ${x + b.w},${y + b.d} ${x},${y + b.d + 10} ${x - b.w},${y + b.d} ${x - b.w - 10},${y - b.h + b.d}`}
                  fill="transparent"
                  style={{ cursor: isLocked ? 'not-allowed' : 'pointer' }}
                  onMouseEnter={() => setHoveredKey(b.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onClick={() => !isLocked && onBuildingClick(b.key, b.chapterNum)}
                />
              )}
            </g>
          )
        })}

        {/* ── Hover tooltip ── */}
        {hoveredKey && (() => {
          const b = BUILDINGS.find((x) => x.key === hoveredKey)
          if (!b) return null
          const { x, y } = gridToScreen(b.col, b.row)
          const status = getBuildingStatus(b)
          const tooltipY = y - b.h - b.d - 50

          return (
            <g>
              <rect x={x - 70} y={tooltipY - 10} width={140} height={40} rx={8}
                fill="#0D1828" stroke="#1E293B" strokeWidth={1} />
              <text x={x} y={tooltipY + 6} textAnchor="middle" fontSize={11} fontWeight="600" fill="#F0F6FF"
                style={{ fontFamily: 'DM Sans, system-ui, sans-serif' }}>
                {b.emoji} {b.name}
              </text>
              {b.npc && (
                <text x={x} y={tooltipY + 20} textAnchor="middle" fontSize={9} fill="#64748B">
                  {b.npc} · {status === 'locked' ? 'Locked' : status === 'completed' ? 'Completed ✓' : 'Chapter ' + b.chapterNum}
                </text>
              )}
            </g>
          )
        })()}

        {/* ── Town title ── */}
        <text x={500} y={20} textAnchor="middle" fontSize={18} fontWeight="700"
          fill="#C9A84C" opacity={0.9}
          style={{ fontFamily: 'Syne, serif', letterSpacing: '0.12em' }}>
          ⚔ ASHMARKET ⚔
        </text>
        <text x={500} y={38} textAnchor="middle" fontSize={10} fill="#64748B"
          style={{ letterSpacing: '0.2em' }}>
          THE APPRENTICE'S REALM
        </text>
      </svg>
    </div>
  )
}
