'use client'

import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, Html } from '@react-three/drei'
import * as THREE from 'three'

interface BuildingProps {
  id: string
  label: string
  position: [number, number, number]
  color: string
  roofColor: string
  size: [number, number, number]
  onClick: (id: string) => void
  available: boolean
  completed: boolean
}

function BuildingMesh({
  id, label, position, color, roofColor, size, onClick, available, completed
}: BuildingProps) {
  const meshRef = useRef<THREE.Mesh>(null!)
  const [hovered, setHovered] = useState(false)
  const [w, h, d] = size

  useFrame((_, delta) => {
    if (hovered && available && !completed) {
      meshRef.current.position.y = position[1] + Math.sin(Date.now() * 0.004) * 0.06
    } else {
      meshRef.current.position.y = THREE.MathUtils.lerp(
        meshRef.current.position.y, position[1], delta * 8
      )
    }
  })

  const emissiveStrength = hovered && available ? 0.25 : 0

  return (
    <group position={position}>
      {/* Base structure */}
      <mesh
        ref={meshRef}
        position={[0, h / 2, 0]}
        onClick={() => available && !completed && onClick(id)}
        onPointerEnter={() => { setHovered(true); document.body.style.cursor = available ? 'pointer' : 'default' }}
        onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'default' }}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissiveStrength}
          roughness={0.7}
          metalness={0.1}
        />
      </mesh>

      {/* Roof */}
      <mesh position={[0, h + 0.3, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[Math.max(w, d) * 0.72, 0.6, 4]} />
        <meshStandardMaterial color={roofColor} roughness={0.6} />
      </mesh>

      {/* Door */}
      <mesh position={[0, 0.45, d / 2 + 0.01]}>
        <boxGeometry args={[0.4, 0.7, 0.02]} />
        <meshStandardMaterial color="#5c3a1e" />
      </mesh>

      {/* Completed badge */}
      {completed && (
        <mesh position={[0, h + 0.9, 0]}>
          <sphereGeometry args={[0.18]} />
          <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.5} />
        </mesh>
      )}

      {/* Label */}
      <Text
        position={[0, h + (completed ? 1.15 : 0.85), 0]}
        fontSize={0.22}
        color={available && !completed ? '#fde68a' : '#9ca3af'}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.015}
        outlineColor="#000"
      >
        {label}
      </Text>

      {/* Hover tooltip */}
      {hovered && available && !completed && (
        <Html position={[0, h + 1.3, 0]} center distanceFactor={10}>
          <div className="bg-stone-900/90 text-amber-300 text-xs px-2 py-1 rounded border border-amber-700 whitespace-nowrap pointer-events-none">
            Click to enter
          </div>
        </Html>
      )}
    </group>
  )
}

export interface BuildingConfig {
  id: string
  label: string
  position: [number, number, number]
  color: string
  roofColor: string
  size: [number, number, number]
}

export const BUILDING_CONFIGS: BuildingConfig[] = [
  { id: 'market_stall',  label: 'Market Stall',  position: [-4,  0,  3], color: '#b45309', roofColor: '#92400e', size: [2.2, 2,   2.2] },
  { id: 'treasury',      label: 'Treasury',       position: [ 4,  0,  3], color: '#1d4ed8', roofColor: '#1e3a8a', size: [2.2, 2.4, 2.2] },
  { id: 'guild_hall',    label: 'Guild Hall',     position: [ 0,  0, -4], color: '#7c3aed', roofColor: '#5b21b6', size: [3,   2.8, 2.8] },
  { id: 'home',          label: 'Home',           position: [-5,  0, -3], color: '#16a34a', roofColor: '#14532d', size: [2,   1.8, 2]   },
  { id: 'trade_caravan', label: 'Trade Caravan',  position: [ 5,  0, -3], color: '#dc2626', roofColor: '#991b1b', size: [2.5, 1.6, 1.8] },
]

interface BuildingsProps {
  completedChapters: string[]
  availableBuildings: string[]
  onBuildingClick: (id: string) => void
}

// Which buildings have any available chapter
export default function Buildings({ completedChapters, availableBuildings, onBuildingClick }: BuildingsProps) {
  return (
    <group>
      {BUILDING_CONFIGS.map(b => {
        const hasCompleted = completedChapters.some(ch => {
          // Check via building assignment mapping
          const BUILDING_MAP: Record<string, string> = {
            ch1: 'market_stall', ch2: 'market_stall',
            ch3: 'trade_caravan',
            ch4: 'guild_hall', ch9: 'guild_hall',
            ch5: 'treasury', ch8: 'treasury',
            ch6: 'trade_caravan',
            ch7: 'home', ch10: 'home',
          }
          return BUILDING_MAP[ch] === b.id
        })
        const isAvailable = availableBuildings.includes(b.id)
        return (
          <BuildingMesh
            key={b.id}
            {...b}
            available={isAvailable}
            completed={hasCompleted && !isAvailable}
            onClick={onBuildingClick}
          />
        )
      })}
    </group>
  )
}
