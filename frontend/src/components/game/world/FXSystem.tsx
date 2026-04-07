'use client'

/**
 * Visual effects: coin burst, XP float, warning pulse
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'

// ── Single coin particle ──────────────────────────────────────────────────────

interface CoinParticle {
  id: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  maxLife: number
}

const COIN_MAT = new THREE.MeshStandardMaterial({
  color: '#c9a84c', metalness: 0.8, roughness: 0.2, emissive: '#8b6914', emissiveIntensity: 0.3
})

function CoinParticles({ particles }: { particles: CoinParticle[] }) {
  const refs = useRef<(THREE.Mesh | null)[]>([])

  useFrame((_, delta) => {
    particles.forEach((p, i) => {
      const mesh = refs.current[i]
      if (!mesh) return
      p.pos.add(p.vel.clone().multiplyScalar(delta))
      p.vel.y -= 4 * delta  // gravity
      p.life -= delta
      mesh.position.copy(p.pos)
      mesh.rotation.x += delta * 5
      mesh.rotation.z += delta * 3
      mesh.scale.setScalar(Math.max(0, p.life / p.maxLife))
    })
  })

  return (
    <>
      {particles.map((p, i) => (
        <mesh key={p.id} ref={el => { refs.current[i] = el }} material={COIN_MAT}>
          <cylinderGeometry args={[0.07, 0.07, 0.015, 10]} />
        </mesh>
      ))}
    </>
  )
}

// ── Floating text ─────────────────────────────────────────────────────────────

interface FloatText {
  id: number
  pos: THREE.Vector3
  text: string
  color: string
  life: number
  maxLife: number
}

function FloatingTexts({ texts }: { texts: FloatText[] }) {
  const refs = useRef<(THREE.Group | null)[]>([])

  useFrame((_, delta) => {
    texts.forEach((ft, i) => {
      const g = refs.current[i]
      if (!g) return
      ft.pos.y += delta * 1.2
      ft.life -= delta
      g.position.copy(ft.pos)
      const alpha = Math.min(1, (ft.life / ft.maxLife) * 2)
      g.scale.setScalar(alpha)
    })
  })

  return (
    <>
      {texts.map((ft, i) => (
        <group key={ft.id} ref={el => { refs.current[i] = el }} position={ft.pos.clone()}>
          <Billboard>
            <Text fontSize={0.28} color={ft.color} anchorX="center" anchorY="middle"
              outlineWidth={0.02} outlineColor="#000" fontWeight="bold">
              {ft.text}
            </Text>
          </Billboard>
        </group>
      ))}
    </>
  )
}

// ── Warning ring pulse ────────────────────────────────────────────────────────

interface WarnRing { id: number; pos: THREE.Vector3; life: number }

function WarningRings({ rings }: { rings: WarnRing[] }) {
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const RING_MAT = new THREE.MeshStandardMaterial({
    color: '#ef4444', emissive: '#ef4444', emissiveIntensity: 1,
    transparent: true, wireframe: true
  })

  useFrame((_, delta) => {
    rings.forEach((r, i) => {
      const m = refs.current[i]
      if (!m) return
      r.life -= delta
      const t = 1 - r.life / 1.5
      m.scale.setScalar(1 + t * 2)
      ;(m.material as THREE.MeshStandardMaterial).opacity = 1 - t
    })
  })

  return (
    <>
      {rings.map((r, i) => (
        <mesh key={r.id} ref={el => { refs.current[i] = el }} position={r.pos} rotation={[-Math.PI / 2, 0, 0]} material={RING_MAT}>
          <torusGeometry args={[0.5, 0.06, 6, 20]} />
        </mesh>
      ))}
    </>
  )
}

// ── FX Manager hook ───────────────────────────────────────────────────────────

let _nextId = 0
const getId = () => ++_nextId

export function useFXSystem() {
  const [coins, setCoins] = useState<CoinParticle[]>([])
  const [texts, setTexts] = useState<FloatText[]>([])
  const [rings, setRings] = useState<WarnRing[]>([])

  // Cleanup dead particles each frame
  useEffect(() => {
    const interval = setInterval(() => {
      setCoins(prev => prev.filter(p => p.life > 0))
      setTexts(prev => prev.filter(t => t.life > 0))
      setRings(prev => prev.filter(r => r.life > 0))
    }, 200)
    return () => clearInterval(interval)
  }, [])

  const spawnCoinBurst = useCallback((pos: THREE.Vector3, count: number = 8) => {
    const newCoins: CoinParticle[] = Array.from({ length: count }, () => ({
      id: getId(),
      pos: pos.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4
      )),
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        2 + Math.random() * 3,
        (Math.random() - 0.5) * 3,
      ),
      life: 1.2 + Math.random() * 0.6,
      maxLife: 1.8,
    }))
    setCoins(prev => [...prev, ...newCoins])
  }, [])

  const spawnXPText = useCallback((pos: THREE.Vector3, xp: number) => {
    setTexts(prev => [...prev, {
      id: getId(), pos: pos.clone().add(new THREE.Vector3(0, 1.5, 0)),
      text: `+${xp} XP`, color: '#a78bfa', life: 2.0, maxLife: 2.0,
    }])
  }, [])

  const spawnGoldText = useCallback((pos: THREE.Vector3, gold: number) => {
    if (gold === 0) return
    setTexts(prev => [...prev, {
      id: getId(), pos: pos.clone().add(new THREE.Vector3(0.3, 1.2, 0)),
      text: gold > 0 ? `+${gold}🪙` : `${gold}🪙`,
      color: gold > 0 ? '#fde68a' : '#f87171',
      life: 1.8, maxLife: 1.8,
    }])
  }, [])

  const spawnWarning = useCallback((pos: THREE.Vector3) => {
    setRings(prev => [...prev, { id: getId(), pos: pos.clone(), life: 1.5 }])
  }, [])

  return { coins, texts, rings, spawnCoinBurst, spawnXPText, spawnGoldText, spawnWarning }
}

// ── Rendered FX layer ─────────────────────────────────────────────────────────

interface FXLayerProps {
  coins: CoinParticle[]
  texts: FloatText[]
  rings: WarnRing[]
}

export function FXLayer({ coins, texts, rings }: FXLayerProps) {
  return (
    <group>
      <CoinParticles particles={coins} />
      <FloatingTexts texts={texts} />
      <WarningRings rings={rings} />
    </group>
  )
}
