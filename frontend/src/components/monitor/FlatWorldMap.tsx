'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { GlobalEvent } from '@/lib/global-monitor-api'

// Mercator projection
function merc(lat: number, lng: number, W: number, H: number): [number, number] {
  const x = ((lng + 180) / 360) * W
  const phi = (lat * Math.PI) / 180
  const y = H / 2 - (W / (2 * Math.PI)) * Math.log(Math.tan(Math.PI / 4 + phi / 2))
  return [x, Math.max(4, Math.min(H - 4, y))]
}

const NEON: Record<string, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#00d4ff', unknown: '#64748b',
}

// Simplified continent polygons [lng, lat]
const CONTINENTS: [number, number][][] = [
  [[-170,71],[-140,72],[-95,72],[-75,65],[-62,47],[-66,44],[-70,41],[-80,25],[-88,15],[-77,8],[-60,5],[-52,12],[-60,46],[-78,44],[-95,49],[-120,49],[-125,50],[-140,59],[-165,65],[-170,71]],
  [[-44,60],[-52,65],[-42,83],[-20,83],[-18,77],[-25,70],[-35,65],[-44,60]],
  [[-80,12],[-60,5],[-50,-1],[-35,-9],[-40,-20],[-43,-23],[-53,-33],[-65,-55],[-68,-54],[-68,-46],[-70,-30],[-75,-10],[-80,0],[-80,12]],
  [[-10,36],[-5,38],[-9,44],[0,46],[3,43],[10,44],[16,48],[12,54],[10,56],[5,58],[0,51],[-5,50],[-5,44],[-10,36]],
  [[-17,15],[-10,8],[0,5],[9,4],[14,3],[14,-5],[12,-17],[17,-22],[20,-34],[26,-34],[32,-28],[35,-18],[38,-10],[40,-2],[42,5],[40,10],[43,12],[40,15],[38,22],[32,31],[18,35],[10,30],[0,27],[-15,18],[-17,15]],
  [[26,72],[50,73],[80,74],[110,72],[130,65],[140,50],[145,44],[143,40],[130,32],[120,22],[110,18],[100,5],[103,2],[105,-6],[115,-8],[120,-8],[115,0],[100,3],[88,22],[75,30],[65,37],[55,28],[45,15],[40,10],[35,15],[35,25],[28,38],[25,52],[24,65],[26,72]],
  [[114,-22],[125,-15],[135,-12],[142,-20],[150,-22],[152,-25],[150,-34],[143,-38],[135,-35],[126,-33],[114,-34],[112,-26],[114,-22]],
  [[130,31],[133,32],[137,37],[141,40],[141,45],[143,44],[141,40],[135,34],[130,31]],
  [[166,-46],[172,-44],[172,-36],[174,-36],[175,-38],[174,-44],[170,-46],[166,-46]],
]

interface Props {
  events: GlobalEvent[]
  onEventClick: (e: GlobalEvent) => void
}

export default function FlatWorldMap({ events, onEventClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hovered, setHovered] = useState<GlobalEvent | null>(null)
  const [tip, setTip] = useState({ x: 0, y: 0 })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.offsetWidth, H = canvas.offsetHeight
    canvas.width = W * devicePixelRatio
    canvas.height = H * devicePixelRatio
    ctx.scale(devicePixelRatio, devicePixelRatio)

    // Ocean
    const ocean = ctx.createLinearGradient(0, 0, 0, H)
    ocean.addColorStop(0,   '#020b1a')
    ocean.addColorStop(0.5, '#040f22')
    ocean.addColorStop(1,   '#020b1a')
    ctx.fillStyle = ocean; ctx.fillRect(0, 0, W, H)

    // Lat/lng grid
    ctx.strokeStyle = 'rgba(0,212,255,0.05)'; ctx.lineWidth = 0.5
    for (let lat = -80; lat <= 80; lat += 20) {
      const [, y] = merc(lat, 0, W, H)
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }
    for (let lng = -180; lng <= 180; lng += 30) {
      const x = ((lng + 180) / 360) * W
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }
    // Equator
    const [, eq] = merc(0, 0, W, H)
    ctx.strokeStyle = 'rgba(0,212,255,0.12)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, eq); ctx.lineTo(W, eq); ctx.stroke()

    // Continents
    CONTINENTS.forEach(pts => {
      ctx.beginPath()
      pts.forEach(([lng, lat], i) => {
        const [x, y] = merc(lat, lng, W, H)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.closePath()
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, 'rgba(22,42,80,0.85)')
      g.addColorStop(1, 'rgba(14,28,60,0.90)')
      ctx.fillStyle = g; ctx.fill()
      ctx.strokeStyle = 'rgba(0,212,255,0.16)'; ctx.lineWidth = 0.75; ctx.stroke()
    })

    // Event markers
    events.forEach(ev => {
      if (!ev.latitude || !ev.longitude) return
      const [x, y] = merc(ev.latitude, ev.longitude, W, H)
      const color = NEON[ev.threat_level ?? 'unknown']
      const r = ev.threat_level === 'critical' ? 7 : ev.threat_level === 'high' ? 6 : 5

      // Radial glow
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4)
      glow.addColorStop(0, color + '55'); glow.addColorStop(1, color + '00')
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill()

      // Core dot
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = color; ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.stroke()
    })
  }, [events])

  useEffect(() => { draw() }, [draw])
  useEffect(() => {
    const ro = new ResizeObserver(() => draw())
    if (canvasRef.current) ro.observe(canvasRef.current)
    return () => ro.disconnect()
  }, [draw])

  const hitTest = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    const W = rect.width, H = rect.height
    return events.find(ev => {
      if (!ev.latitude || !ev.longitude) return false
      const [x, y] = merc(ev.latitude, ev.longitude, W, H)
      return Math.hypot(mx - x, my - y) < 12
    }) ?? null
  }, [events])

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full"
        style={{ cursor: hovered ? 'pointer' : 'crosshair' }}
        onMouseMove={e => { const h = hitTest(e); setHovered(h); if (h) setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }) }}
        onMouseLeave={() => setHovered(null)}
        onClick={e => { const h = hitTest(e); if (h) onEventClick(h) }}
      />

      {/* Badge */}
      <div className="absolute top-3 left-3 z-10">
        <div className="frosted-chip px-2.5 py-1 text-[9px] font-mono text-fg-secondary flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          2D · MERCATOR FLAT MAP
        </div>
      </div>

      {/* Event counts */}
      <div className="absolute bottom-3 left-3 z-10 flex gap-1.5">
        {[
          { label: 'CRITICAL', c: '#ef4444', n: events.filter(e => e.threat_level === 'critical').length },
          { label: 'HIGH',     c: '#f97316', n: events.filter(e => e.threat_level === 'high').length },
          { label: 'TOTAL',    c: '#00d4ff', n: events.length },
        ].map(l => (
          <div key={l.label} className="frosted-chip px-2 py-1 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: l.c }} />
            <span className="text-[9px] font-bold font-mono" style={{ color: l.c }}>{l.n}</span>
            <span className="text-[8px] text-fg-muted">{l.label}</span>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {hovered && (
        <div className="absolute z-20 pointer-events-none glass-panel-strong rounded-xl px-3 py-2 text-[10px] max-w-[190px]"
          style={{ left: tip.x + 14, top: tip.y - 36, borderColor: `${NEON[hovered.threat_level ?? 'unknown']}40` }}>
          <p className="font-bold text-white leading-snug mb-0.5 truncate">{hovered.title}</p>
          <p className="text-fg-muted font-mono">{hovered.location_name}</p>
        </div>
      )}
    </div>
  )
}
