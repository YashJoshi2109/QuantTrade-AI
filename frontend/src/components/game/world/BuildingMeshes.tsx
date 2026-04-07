'use client'

/**
 * Detailed procedural building meshes for Ashmarket
 */

import { useRef, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, Billboard } from '@react-three/drei'
import * as THREE from 'three'
import { CHAPTERS, getChapterStatus } from '@/lib/student-chapters'

// ── Building chapter mapping ──────────────────────────────────────────────────
export const BUILDING_CHAPTER_MAP: Record<string, string[]> = {
  // Stage 1 — Apprentice
  market_stall:   ['ch1', 'ch2', 'ch3'],
  treasury:       ['ch5', 'ch8'],
  guild_hall:     ['ch4', 'ch9'],
  home:           ['ch7', 'ch10'],
  trade_caravan:  ['ch6'],
  // Stage 2 — Young Merchant
  counting_house: ['ch11', 'ch16'],
  trading_post:   ['ch12', 'ch14'],
  town_hall:      ['ch13', 'ch15'],
  apothecary:     ['ch17', 'ch18'],
}

export function getAvailableChapter(buildingId: string, completed: string[]): string | null {
  const candidates = BUILDING_CHAPTER_MAP[buildingId] ?? []
  for (const chId of candidates) {
    if (completed.includes(chId)) continue
    const idx = CHAPTERS.findIndex(c => c.id === chId)
    if (idx === 0) return chId
    const prev = CHAPTERS[idx - 1]
    if (!prev || completed.includes(prev.id)) return chId
  }
  return null
}

// ── Material factory ──────────────────────────────────────────────────────────

function useMat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opts }), [color])
}

// ── Window component ──────────────────────────────────────────────────────────

function Window({ position, lit = false }: { position: [number, number, number]; lit?: boolean }) {
  const frameMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2c1a0e', roughness: 0.6 }), [])
  const glassMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: lit ? '#fde68a' : '#94a3b8',
    emissive: lit ? '#fbbf24' : '#1e3a5f',
    emissiveIntensity: lit ? 0.9 : 0.1,
    transparent: true, opacity: 0.85
  }), [lit])

  return (
    <group position={position}>
      <mesh material={frameMat}><boxGeometry args={[0.36, 0.36, 0.05]} /></mesh>
      <mesh position={[0, 0, 0.03]} material={glassMat}><boxGeometry args={[0.26, 0.26, 0.02]} /></mesh>
      {/* Cross */}
      <mesh position={[0, 0, 0.04]} material={frameMat}><boxGeometry args={[0.28, 0.025, 0.01]} /></mesh>
      <mesh position={[0, 0, 0.04]} material={frameMat}><boxGeometry args={[0.025, 0.28, 0.01]} /></mesh>
    </group>
  )
}

// ── Door component ────────────────────────────────────────────────────────────

function Door({ position, h = 0.85 }: { position: [number, number, number]; h?: number }) {
  const doorMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a2810', roughness: 0.8 }), [])
  const hingesMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a1a0a', metalness: 0.7, roughness: 0.3 }), [])
  const frameMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2c1a0e', roughness: 0.7 }), [])

  return (
    <group position={position}>
      {/* Door frame */}
      <mesh material={frameMat}><boxGeometry args={[0.6, h + 0.08, 0.06]} /></mesh>
      {/* Door panel */}
      <mesh position={[0, 0, 0.02]} material={doorMat}><boxGeometry args={[0.5, h, 0.04]} /></mesh>
      {/* Hinges */}
      {[-h * 0.3, h * 0.3].map((y, i) => (
        <mesh key={i} position={[-0.22, y, 0.04]} material={hingesMat}>
          <boxGeometry args={[0.06, 0.08, 0.04]} />
        </mesh>
      ))}
      {/* Door knob */}
      <mesh position={[0.18, 0, 0.06]} material={hingesMat}>
        <sphereGeometry args={[0.04, 6, 6]} />
      </mesh>
    </group>
  )
}

// ── Tiled roof ────────────────────────────────────────────────────────────────

function TiledRoof({ w, d, h, color, position }: { w: number; d: number; h: number; color: string; position: [number, number, number] }) {
  const mat = useMat(color, { roughness: 0.7 })
  const detailMat = useMat(new THREE.Color(color).multiplyScalar(0.75).getStyle())

  return (
    <group position={position}>
      <mesh material={mat} castShadow>
        <coneGeometry args={[Math.max(w, d) * 0.72, h, 4, 1]} />
      </mesh>
      {/* Ridge caps */}
      <mesh position={[0, h * 0.4, 0]} material={detailMat}>
        <boxGeometry args={[0.12, h * 0.12, Math.max(w, d) * 0.55]} />
      </mesh>
    </group>
  )
}

// ── Banner / sign ─────────────────────────────────────────────────────────────

function HangingBanner({ position, color, text }: { position: [number, number, number]; color: string; text: string }) {
  const ref = useRef<THREE.Group>(null!)
  const bannerMat = useMat(color, { roughness: 0.8 })
  const tickOff = useRef(Math.random() * Math.PI * 2)

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.z = Math.sin(clock.getElapsedTime() * 0.7 + tickOff.current) * 0.04
    }
  })

  return (
    <group ref={ref} position={position}>
      {/* Banner cloth */}
      <mesh material={bannerMat} castShadow>
        <boxGeometry args={[0.6, 0.5, 0.03]} />
      </mesh>
      {/* Banner pole */}
      <mesh position={[0, 0.28, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.06, 6]} />
        <meshStandardMaterial color="#5c3a1e" />
      </mesh>
    </group>
  )
}

// ── Base building component ───────────────────────────────────────────────────

interface BuildingProps {
  id: string
  label: string
  position: [number, number, number]
  wallColor: string
  roofColor: string
  accentColor: string
  size: [number, number, number]   // [w, h, d]
  available: boolean
  completed: boolean
  locked: boolean
  onClick: () => void
}

function BuildingBase({ id, label, position, wallColor, roofColor, accentColor, size, available, completed, locked, onClick }: BuildingProps) {
  const [w, h, d] = size
  const [hovered, setHovered] = useState(false)
  const glowRef = useRef<THREE.PointLight>(null!)
  const groupRef = useRef<THREE.Group>(null!)
  const tick = useRef(0)

  const wallMat   = useMat(wallColor)
  const accentMat = useMat(accentColor)
  const stoneMat  = useMat('#6b6252', { roughness: 0.95 })
  const timberMat = useMat('#4a2c14', { roughness: 0.85 })

  useFrame((_, delta) => {
    tick.current += delta
    if (glowRef.current) {
      glowRef.current.intensity = available
        ? 3 + Math.sin(tick.current * 2) * 1
        : (hovered ? 1.5 : 0)
    }
    if (groupRef.current && hovered) {
      groupRef.current.position.y = position[1] + Math.sin(tick.current * 3) * 0.015
    } else if (groupRef.current) {
      groupRef.current.position.y = position[1]
    }
  })

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={onClick}
      onPointerEnter={() => { setHovered(true); document.body.style.cursor = available ? 'pointer' : 'default' }}
      onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'default' }}
    >
      {/* Availability glow */}
      <pointLight ref={glowRef} position={[0, h * 0.5, 0]} color={accentColor} distance={6} decay={2} />

      {/* Stone foundation */}
      <mesh position={[0, 0.12, 0]} material={stoneMat} receiveShadow castShadow>
        <boxGeometry args={[w + 0.2, 0.24, d + 0.2]} />
      </mesh>

      {/* Main walls */}
      <mesh position={[0, h / 2 + 0.24, 0]} material={wallMat} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
      </mesh>

      {/* Timber framing (visible beams) */}
      {[-w * 0.38, 0, w * 0.38].map((x, i) => (
        <mesh key={i} position={[x, h / 2 + 0.24, d / 2 + 0.01]} material={timberMat} castShadow>
          <boxGeometry args={[0.05, h, 0.04]} />
        </mesh>
      ))}
      <mesh position={[0, h * 0.65 + 0.24, d / 2 + 0.01]} material={timberMat} castShadow>
        <boxGeometry args={[w, 0.06, 0.04]} />
      </mesh>

      {/* Accent trim */}
      <mesh position={[0, h + 0.16, 0]} material={accentMat}>
        <boxGeometry args={[w + 0.08, 0.08, d + 0.08]} />
      </mesh>

      {/* Windows */}
      <Window position={[-w * 0.28, h * 0.68 + 0.24, d / 2 + 0.03]} lit={available} />
      <Window position={[w * 0.28, h * 0.68 + 0.24, d / 2 + 0.03]} lit={available} />

      {/* Door */}
      <Door position={[0, 0.54, d / 2 + 0.03]} h={0.8} />

      {/* Roof */}
      <TiledRoof w={w} d={d} h={0.7} color={roofColor} position={[0, h + 0.59, 0]} />

      {/* Chimney */}
      <mesh position={[w * 0.3, h + 0.6, -d * 0.2]} material={stoneMat} castShadow>
        <boxGeometry args={[0.2, 0.7, 0.2]} />
      </mesh>

      {/* Hanging banner */}
      <HangingBanner position={[0, h + 0.1, d / 2 + 0.12]} color={accentColor} text={label} />

      {/* Locked overlay — semi-transparent dark shroud */}
      {locked && (
        <mesh position={[0, h / 2 + 0.24, 0]}>
          <boxGeometry args={[w + 0.3, h + 0.5, d + 0.3]} />
          <meshStandardMaterial color="#000" transparent opacity={0.45} />
        </mesh>
      )}

      {/* Completed indicator */}
      {completed && (
        <mesh position={[0, h + 1.3, 0]}>
          <sphereGeometry args={[0.14]} />
          <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.7} />
        </mesh>
      )}

      {/* Name label */}
      <Billboard position={[0, h + (available ? 1.55 : 1.25), 0]}>
        <Text
          fontSize={0.2} color={available ? '#fde68a' : completed ? '#4ade80' : locked ? '#6b7280' : '#94a3b8'}
          anchorX="center" anchorY="middle"
          outlineWidth={0.015} outlineColor="#000"
          fontWeight="bold"
        >
          {locked ? `🔒 ${label}` : label}
        </Text>
      </Billboard>
    </group>
  )
}

// ── Building configs ──────────────────────────────────────────────────────────

export interface BuildingConfig {
  id: string
  label: string
  position: [number, number, number]
  wallColor: string
  roofColor: string
  accentColor: string
  size: [number, number, number]
}

export const BUILDING_CONFIGS: BuildingConfig[] = [
  {
    id: 'market_stall', label: 'Market Stall',
    position: [-4, 0, 3.5],
    wallColor: '#c2a46a', roofColor: '#7c3d0c', accentColor: '#e8a020',
    size: [2.6, 2.2, 2.4],
  },
  {
    id: 'treasury', label: 'Treasury',
    position: [4, 0, 3.5],
    wallColor: '#9bafc4', roofColor: '#1e3a8a', accentColor: '#3b82f6',
    size: [2.6, 2.8, 2.4],
  },
  {
    id: 'guild_hall', label: 'Guild Hall',
    position: [0, 0, -4.5],
    wallColor: '#c4a4cc', roofColor: '#4c1d95', accentColor: '#8b5cf6',
    size: [3.4, 3.2, 3.0],
  },
  {
    id: 'home', label: 'Home',
    position: [-5.5, 0, -3.5],
    wallColor: '#a8c4a4', roofColor: '#14532d', accentColor: '#22c55e',
    size: [2.4, 2.0, 2.2],
  },
  {
    id: 'trade_caravan', label: 'Trade Caravan',
    position: [5.5, 0, -3.5],
    wallColor: '#c4a0a0', roofColor: '#7f1d1d', accentColor: '#ef4444',
    size: [2.8, 1.8, 2.2],
  },
  // ── Stage 2: Young Merchant buildings ────────────────────────────────────
  {
    id: 'counting_house', label: 'Counting House',
    position: [8.5, 0, 1.5],
    wallColor: '#b8a86a', roofColor: '#5c3a0a', accentColor: '#d4af37',
    size: [2.8, 2.6, 2.4],
  },
  {
    id: 'trading_post', label: 'Trading Post',
    position: [-8.5, 0, 1.5],
    wallColor: '#b06040', roofColor: '#7a2010', accentColor: '#e84020',
    size: [2.6, 2.2, 2.2],
  },
  {
    id: 'town_hall', label: 'Town Hall',
    position: [3.5, 0, -7.5],
    wallColor: '#c0c0a0', roofColor: '#306020', accentColor: '#40c020',
    size: [3.4, 3.6, 3.2],
  },
  {
    id: 'apothecary', label: 'Apothecary',
    position: [-3.5, 0, -7.5],
    wallColor: '#a0c0b0', roofColor: '#205040', accentColor: '#20c080',
    size: [2.4, 2.2, 2.0],
  },
]

// ── Assembled buildings ───────────────────────────────────────────────────────

interface BuildingsProps {
  completedChapters: string[]
  onBuildingClick: (id: string) => void
}

export default function Buildings({ completedChapters, onBuildingClick }: BuildingsProps) {
  return (
    <group>
      {BUILDING_CONFIGS.map(b => {
        const available = getAvailableChapter(b.id, completedChapters) !== null
        const allChaptersDone = (BUILDING_CHAPTER_MAP[b.id] ?? []).every(ch => completedChapters.includes(ch))
        const completed = !available && allChaptersDone
        // Locked = no available chapter AND not all done (chapters exist but prerequisites not met)
        const locked = !available && !allChaptersDone

        return (
          <BuildingBase
            key={b.id}
            {...b}
            available={available}
            completed={completed}
            locked={locked}
            onClick={() => available && onBuildingClick(b.id)}
          />
        )
      })}
    </group>
  )
}
