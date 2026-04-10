'use client'

/**
 * Procedural 3D character system for Ashmarket
 * All characters built from Three.js geometry — no external models needed
 */

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, Billboard } from '@react-three/drei'
import * as THREE from 'three'

// ── Shared materials ────────────────────────────────────────────────────────

function useMat(color: string, emissive = '#000', emissiveIntensity = 0) {
  return useMemo(() => new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity, roughness: 0.7, metalness: 0.05
  }), [color, emissive, emissiveIntensity])
}

// ── Skin tones ───────────────────────────────────────────────────────────────
const SKIN_TONES = ['#f5c5a3', '#e8a87c', '#c68642', '#8d5524']

// ── Player character ─────────────────────────────────────────────────────────

interface PlayerMeshProps {
  gender?: 'male' | 'female'
  skinTone?: number
  moving?: boolean
}

export function PlayerMesh({ gender = 'male', skinTone = 0, moving = false }: PlayerMeshProps) {
  const rootRef = useRef<THREE.Group>(null!)
  const legsRef = useRef<THREE.Group>(null!)
  const capeRef = useRef<THREE.Mesh>(null!)
  const tick = useRef(0)
  const skin = SKIN_TONES[skinTone] ?? SKIN_TONES[0]!

  // Materials
  const skinMat = useMat(skin)
  const tuneMat = useMat(gender === 'male' ? '#3b1d8e' : '#8e1d5e')
  const pantMat = useMat('#2a1a6e')
  const bootMat = useMat('#2c1a0e')
  const hairMat = useMat(gender === 'male' ? '#3d2b1f' : '#8b4513')
  const beltMat = useMat('#8b6914')
  const capeMat = useMat('#6d1a1a', '#7a1e1e', 0.1)
  const hatMat  = useMat('#1a1032')

  const armsRef = useRef<THREE.Group>(null!)
  const headRef = useRef<THREE.Group>(null!)

  useFrame((_, delta) => {
    if (!rootRef.current) return
    tick.current += delta
    const t = tick.current

    // Breathing — subtle chest rise + body sway
    rootRef.current.position.y = Math.sin(t * 1.5) * 0.012 + Math.sin(t * 0.7) * 0.005
    rootRef.current.rotation.z = Math.sin(t * 0.8) * 0.008 // Idle sway

    // Walking — realistic leg + arm + head bob
    if (moving && legsRef.current) {
      const walkSpeed = 8
      const legSwing = Math.sin(t * walkSpeed) * 0.35  // Larger leg range
      const legs = legsRef.current.children
      if (legs[0]) (legs[0] as THREE.Mesh).rotation.x = legSwing
      if (legs[1]) (legs[1] as THREE.Mesh).rotation.x = -legSwing

      // Arm counter-swing (opposite to legs for realism)
      if (armsRef.current) {
        const arms = armsRef.current.children
        if (arms[0]) (arms[0] as THREE.Mesh).rotation.x = -legSwing * 0.6
        if (arms[1]) (arms[1] as THREE.Mesh).rotation.x = legSwing * 0.6
      }

      // Walk bounce (vertical bob on each step)
      rootRef.current.position.y += Math.abs(Math.sin(t * walkSpeed)) * 0.025

      // Head slight nod when walking
      if (headRef.current) {
        headRef.current.rotation.x = Math.sin(t * walkSpeed * 2) * 0.03
        headRef.current.rotation.z = Math.sin(t * walkSpeed) * 0.02
      }
    } else {
      // Idle — subtle arm sway + head look-around
      if (armsRef.current) {
        const arms = armsRef.current.children
        if (arms[0]) (arms[0] as THREE.Mesh).rotation.x = Math.sin(t * 1.2) * 0.03
        if (arms[1]) (arms[1] as THREE.Mesh).rotation.x = Math.sin(t * 1.2 + 0.5) * 0.03
      }
      if (headRef.current) {
        headRef.current.rotation.y = Math.sin(t * 0.4) * 0.06 // Slow head turn
        headRef.current.rotation.x = Math.sin(t * 0.6) * 0.02
      }
    }

    // Cape physics — more dramatic when moving
    if (capeRef.current) {
      const windBase = Math.sin(t * 2.5) * 0.06
      const moveBoost = moving ? 0.2 + Math.sin(t * 6) * 0.05 : 0
      capeRef.current.rotation.x = windBase + moveBoost
      capeRef.current.rotation.z = Math.sin(t * 1.8) * 0.03
    }
  })

  return (
    <group ref={rootRef}>
      {/* Boots */}
      <mesh position={[-0.09, 0.12, 0]} material={bootMat} castShadow>
        <boxGeometry args={[0.12, 0.24, 0.16]} />
      </mesh>
      <mesh position={[0.09, 0.12, 0]} material={bootMat} castShadow>
        <boxGeometry args={[0.12, 0.24, 0.16]} />
      </mesh>

      {/* Legs */}
      <group ref={legsRef}>
        <mesh position={[-0.09, 0.42, 0]} material={pantMat} castShadow>
          <boxGeometry args={[0.13, 0.3, 0.14]} />
        </mesh>
        <mesh position={[0.09, 0.42, 0]} material={pantMat} castShadow>
          <boxGeometry args={[0.13, 0.3, 0.14]} />
        </mesh>
      </group>

      {/* Belt */}
      <mesh position={[0, 0.58, 0]} material={beltMat} castShadow>
        <boxGeometry args={[0.32, 0.06, 0.18]} />
      </mesh>

      {/* Tunic / body */}
      <mesh position={[0, 0.82, 0]} material={tuneMat} castShadow>
        <boxGeometry args={[0.3, 0.42, 0.18]} />
      </mesh>

      {/* Arms */}
      <group ref={armsRef}>
      <mesh position={[-0.21, 0.82, 0]} material={tuneMat} castShadow>
        <boxGeometry args={[0.1, 0.35, 0.1]} />
      </mesh>
      <mesh position={[0.21, 0.82, 0]} material={tuneMat} castShadow>
        <boxGeometry args={[0.1, 0.35, 0.1]} />
      </mesh>

      {/* Hands */}
      <mesh position={[-0.21, 0.62, 0]} material={skinMat} castShadow>
        <sphereGeometry args={[0.055, 6, 6]} />
      </mesh>
      <mesh position={[0.21, 0.62, 0]} material={skinMat} castShadow>
        <sphereGeometry args={[0.055, 6, 6]} />
      </mesh>
      </group>

      {/* Cape */}
      <mesh ref={capeRef} position={[0, 0.8, -0.1]} material={capeMat} castShadow>
        <boxGeometry args={[0.28, 0.5, 0.04]} />
      </mesh>

      {/* Head group (for head animations) */}
      <group ref={headRef}>
      {/* Neck */}
      <mesh position={[0, 1.07, 0]} material={skinMat} castShadow>
        <cylinderGeometry args={[0.065, 0.075, 0.1, 8]} />
      </mesh>

      {/* Head */}
      <mesh position={[0, 1.21, 0]} material={skinMat} castShadow>
        <boxGeometry args={[0.22, 0.22, 0.2]} />
      </mesh>

      {/* Eyes */}
      <mesh position={[-0.055, 1.23, 0.102]}>
        <sphereGeometry args={[0.022, 6, 6]} />
        <meshStandardMaterial color="#1a0f0a" />
      </mesh>
      <mesh position={[0.055, 1.23, 0.102]}>
        <sphereGeometry args={[0.022, 6, 6]} />
        <meshStandardMaterial color="#1a0f0a" />
      </mesh>

      {/* Hair */}
      <mesh position={[0, 1.31, 0]} material={hairMat} castShadow>
        <boxGeometry args={[0.235, 0.08, 0.215]} />
      </mesh>

      {/* Hat brim */}
      <mesh position={[0, 1.38, 0]} material={hatMat} castShadow>
        <cylinderGeometry args={[0.19, 0.19, 0.04, 8]} />
      </mesh>
      {/* Hat top */}
      <mesh position={[0, 1.56, 0]} material={hatMat} castShadow>
        <cylinderGeometry args={[0.1, 0.16, 0.36, 8]} />
      </mesh>

      {/* Hat feather */}
      <mesh position={[0.12, 1.65, 0]} rotation={[0, 0, Math.PI / 6]}>
        <boxGeometry args={[0.04, 0.22, 0.02]} />
        <meshStandardMaterial color="#e8c84e" emissive="#c9a82a" emissiveIntensity={0.3} />
      </mesh>
      </group>
    </group>
  )
}

// ── Generic NPC template ──────────────────────────────────────────────────────

interface NPCProps {
  position: [number, number, number]
  robeColor: string
  hatColor: string
  skinTone?: number
  label: string
  available?: boolean
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onClick?: () => void
}

function NPCMesh({
  position, robeColor, hatColor, skinTone = 1,
  label, available = false,
  onPointerEnter, onPointerLeave, onClick
}: NPCProps) {
  const groupRef = useRef<THREE.Group>(null!)
  const glowRef = useRef<THREE.PointLight>(null!)
  const tick = useRef(Math.random() * Math.PI * 2) // stagger
  const skin = SKIN_TONES[skinTone] ?? SKIN_TONES[1]!

  const robeMat   = useMat(robeColor)
  const hatMat    = useMat(hatColor)
  const skinMat   = useMat(skin)
  const sandaMat  = useMat('#6b4c2a')

  useFrame((_, delta) => {
    tick.current += delta
    if (!groupRef.current) return
    // Gentle idle bob
    groupRef.current.position.y = position[1] + Math.sin(tick.current * 1.2) * 0.02
    // Subtle side sway
    groupRef.current.rotation.z = Math.sin(tick.current * 0.8) * 0.03

    // Glow pulse when available
    if (glowRef.current) {
      glowRef.current.intensity = available
        ? 4 + Math.sin(tick.current * 2.5) * 1.5
        : 0
    }
  })

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {/* Availability glow */}
      <pointLight ref={glowRef} color="#fde68a" distance={3} decay={2} intensity={0} />

      {/* Sandals */}
      <mesh position={[-0.07, 0.06, 0]} material={sandaMat}><boxGeometry args={[0.1, 0.06, 0.14]} /></mesh>
      <mesh position={[0.07, 0.06, 0]} material={sandaMat}><boxGeometry args={[0.1, 0.06, 0.14]} /></mesh>

      {/* Robe */}
      <mesh position={[0, 0.55, 0]} material={robeMat} castShadow>
        <cylinderGeometry args={[0.18, 0.22, 0.9, 8]} />
      </mesh>
      {/* Robe top (shoulders) */}
      <mesh position={[0, 0.84, 0]} material={robeMat} castShadow>
        <boxGeometry args={[0.28, 0.3, 0.2]} />
      </mesh>

      {/* Arms */}
      <mesh position={[-0.2, 0.8, 0]} rotation={[0, 0, 0.3]} material={robeMat} castShadow>
        <cylinderGeometry args={[0.055, 0.055, 0.3, 6]} />
      </mesh>
      <mesh position={[0.2, 0.8, 0]} rotation={[0, 0, -0.3]} material={robeMat} castShadow>
        <cylinderGeometry args={[0.055, 0.055, 0.3, 6]} />
      </mesh>

      {/* Hands */}
      <mesh position={[-0.22, 0.67, 0.04]} material={skinMat}><sphereGeometry args={[0.05, 6, 6]} /></mesh>
      <mesh position={[0.22, 0.67, 0.04]} material={skinMat}><sphereGeometry args={[0.05, 6, 6]} /></mesh>

      {/* Head */}
      <mesh position={[0, 1.1, 0]} material={skinMat} castShadow>
        <sphereGeometry args={[0.15, 10, 10]} />
      </mesh>

      {/* Eyes */}
      <mesh position={[-0.055, 1.13, 0.14]}><sphereGeometry args={[0.018, 5, 5]} /><meshStandardMaterial color="#1a0a00" /></mesh>
      <mesh position={[0.055, 1.13, 0.14]}><sphereGeometry args={[0.018, 5, 5]} /><meshStandardMaterial color="#1a0a00" /></mesh>

      {/* Hat brim */}
      <mesh position={[0, 1.23, 0]} material={hatMat}><cylinderGeometry args={[0.2, 0.2, 0.04, 8]} /></mesh>
      {/* Hat crown */}
      <mesh position={[0, 1.4, 0]} material={hatMat}><cylinderGeometry args={[0.1, 0.18, 0.32, 8]} /></mesh>

      {/* Quest bubble above */}
      {available && (
        <Billboard position={[0, 1.85, 0]}>
          <mesh>
            <circleGeometry args={[0.18, 16]} />
            <meshStandardMaterial color="#fde68a" emissive="#fbbf24" emissiveIntensity={0.8} transparent opacity={0.95} />
          </mesh>
          <Text position={[0, 0, 0.01]} fontSize={0.18} color="#7c2d12" anchorX="center" anchorY="middle" fontWeight="bold">!</Text>
        </Billboard>
      )}

      {/* Name label */}
      <Billboard position={[0, 1.7, 0]}>
        <Text fontSize={0.1} color={available ? '#fde68a' : '#9ca3af'} anchorX="center" anchorY="middle" outlineWidth={0.01} outlineColor="#000">
          {label}
        </Text>
      </Billboard>
    </group>
  )
}

// ── Exported NPC configs ─────────────────────────────────────────────────────

export interface NPCConfig {
  id: string
  label: string
  position: [number, number, number]
  robeColor: string
  hatColor: string
  skinTone: number
  buildingId: string
}

export const NPC_CONFIGS: NPCConfig[] = [
  { id: 'merchant_rafiq', label: 'Merchant Rafiq', position: [-4.4, 0, 3.8],   robeColor: '#c27b2a', hatColor: '#8b5e1a', skinTone: 2, buildingId: 'market_stall'  },
  { id: 'banker_colm',    label: 'Banker Colm',    position: [ 4.4, 0, 3.8],   robeColor: '#1e3a8a', hatColor: '#1e3a8a', skinTone: 0, buildingId: 'treasury'      },
  { id: 'elder_sera',     label: 'Elder Sera',     position: [ 0.4, 0,-4.8],   robeColor: '#5b21b6', hatColor: '#4c1d95', skinTone: 1, buildingId: 'guild_hall'    },
  { id: 'neighbor_bess',  label: 'Neighbor Bess',  position: [-5.4, 0,-3.8],   robeColor: '#065f46', hatColor: '#064e3b', skinTone: 3, buildingId: 'home'          },
  { id: 'rafiq_caravan',  label: 'Caravan Rafiq',  position: [ 5.4, 0,-3.8],   robeColor: '#991b1b', hatColor: '#7f1d1d', skinTone: 2, buildingId: 'trade_caravan' },
  // Stage 2 NPCs
  { id: 'tax_clerk_petyr', label: 'Tax Clerk Petyr', position: [ 8.5, 0, 3.2],  robeColor: '#2d4a2d', hatColor: '#1a3020', skinTone: 0, buildingId: 'counting_house' },
  { id: 'broker_veda',     label: 'Broker Veda',     position: [-8.5, 0, 3.2],  robeColor: '#1e3a5f', hatColor: '#152a45', skinTone: 3, buildingId: 'trading_post'   },
  { id: 'scribe_aldric',   label: 'Scribe Aldric',   position: [ 3.5, 0,-5.8],  robeColor: '#4a3820', hatColor: '#33280f', skinTone: 1, buildingId: 'town_hall'      },
  { id: 'healer_maren',    label: 'Healer Maren',    position: [-3.5, 0,-5.8],  robeColor: '#1a5040', hatColor: '#103830', skinTone: 2, buildingId: 'apothecary'     },
]

interface NPCSystemProps {
  availableBuildings: string[]
  onNPCClick: (buildingId: string) => void
}

export function NPCSystem({ availableBuildings, onNPCClick }: NPCSystemProps) {
  return (
    <group>
      {NPC_CONFIGS.map(npc => (
        <NPCMesh
          key={npc.id}
          position={npc.position}
          robeColor={npc.robeColor}
          hatColor={npc.hatColor}
          skinTone={npc.skinTone}
          label={npc.label}
          available={availableBuildings.includes(npc.buildingId)}
          onClick={() => availableBuildings.includes(npc.buildingId) && onNPCClick(npc.buildingId)}
        />
      ))}
    </group>
  )
}

