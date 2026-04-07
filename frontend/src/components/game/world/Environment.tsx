'use client'

/**
 * Environment system — ground, props, atmosphere
 * Trees, barrels, crates, lanterns, fence, well, coin piles
 */

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Sky, Stars } from '@react-three/drei'
import * as THREE from 'three'

// ── Ground & Path ─────────────────────────────────────────────────────────────

export function Ground() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(60, 60, 40, 40)
    // Slight vertex noise for organic look
    const pos = g.attributes.position!
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, (Math.random() - 0.5) * 0.04)
    }
    g.computeVertexNormals()
    return g
  }, [])

  return (
    <group>
      {/* Base ground */}
      <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial color="#2d2416" roughness={1} />
      </mesh>

      {/* Cobblestone paths to buildings */}
      {/* Center cross path */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1.6, 12]} />
        <meshStandardMaterial color="#4a3d2c" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[1.6, 14]} />
        <meshStandardMaterial color="#4a3d2c" roughness={0.95} />
      </mesh>

      {/* Central town square stone circle */}
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[2.5, 32]} />
        <meshStandardMaterial color="#564a38" roughness={0.9} />
      </mesh>
    </group>
  )
}

// ── Tree ──────────────────────────────────────────────────────────────────────

function Tree({ position }: { position: [number, number, number] }) {
  const trunkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a2e0e', roughness: 0.9 }), [])
  const leaf1Mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1a4d1a', roughness: 0.8 }), [])
  const leaf2Mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#22662a', roughness: 0.8 }), [])
  const treeRef = useRef<THREE.Group>(null!)
  const tickOff = useRef(Math.random() * Math.PI * 2)

  useFrame(({ clock }) => {
    if (!treeRef.current) return
    const t = clock.getElapsedTime() + tickOff.current
    treeRef.current.rotation.z = Math.sin(t * 0.6) * 0.02
  })

  return (
    <group ref={treeRef} position={position}>
      {/* Trunk */}
      <mesh position={[0, 0.7, 0]} material={trunkMat} castShadow>
        <cylinderGeometry args={[0.12, 0.18, 1.4, 7]} />
      </mesh>
      {/* Foliage layers */}
      <mesh position={[0, 1.8, 0]} material={leaf1Mat} castShadow>
        <coneGeometry args={[0.9, 1.2, 7]} />
      </mesh>
      <mesh position={[0, 2.5, 0]} material={leaf2Mat} castShadow>
        <coneGeometry args={[0.65, 1.0, 7]} />
      </mesh>
      <mesh position={[0, 3.1, 0]} material={leaf1Mat} castShadow>
        <coneGeometry args={[0.4, 0.8, 6]} />
      </mesh>
    </group>
  )
}

// ── Barrel ───────────────────────────────────────────────────────────────────

function Barrel({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const woodMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b4423', roughness: 0.85 }), [])
  const bandMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3d2a14', roughness: 0.6 }), [])

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh material={woodMat} castShadow>
        <cylinderGeometry args={[0.22, 0.2, 0.42, 10]} />
      </mesh>
      {/* Metal bands */}
      {[-0.12, 0, 0.12].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} material={bandMat}>
          <torusGeometry args={[0.22, 0.02, 4, 12]} />
        </mesh>
      ))}
    </group>
  )
}

// ── Crate ────────────────────────────────────────────────────────────────────

function Crate({ position }: { position: [number, number, number] }) {
  const woodMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8b6340', roughness: 0.9 }), [])
  return (
    <mesh position={position} material={woodMat} castShadow>
      <boxGeometry args={[0.4, 0.4, 0.4]} />
    </mesh>
  )
}

// ── Lantern Post ─────────────────────────────────────────────────────────────

function LanternPost({ position }: { position: [number, number, number] }) {
  const metalMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.4, metalness: 0.8 }), [])
  const glassMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#fde68a', emissive: '#fbbf24', emissiveIntensity: 0.8,
    transparent: true, opacity: 0.85
  }), [])
  const glowRef = useRef<THREE.PointLight>(null!)
  const tickOff = useRef(Math.random() * Math.PI * 2)

  useFrame(({ clock }) => {
    if (glowRef.current) {
      glowRef.current.intensity = 5 + Math.sin(clock.getElapsedTime() * 3 + tickOff.current) * 0.8
    }
  })

  return (
    <group position={position}>
      {/* Post */}
      <mesh material={metalMat} castShadow>
        <cylinderGeometry args={[0.04, 0.06, 2.4, 6]} />
      </mesh>
      {/* Arm */}
      <mesh position={[0.18, 1.1, 0]} rotation={[0, 0, Math.PI / 2]} material={metalMat}>
        <cylinderGeometry args={[0.03, 0.03, 0.36, 5]} />
      </mesh>
      {/* Lantern housing */}
      <mesh position={[0.36, 1.1, 0]} material={metalMat}>
        <boxGeometry args={[0.18, 0.22, 0.18]} />
      </mesh>
      {/* Glow glass */}
      <mesh position={[0.36, 1.1, 0]} material={glassMat}>
        <boxGeometry args={[0.12, 0.16, 0.12]} />
      </mesh>
      <pointLight ref={glowRef} position={[0.36, 1.1, 0]} color="#ffa040" distance={5} decay={2} castShadow={false} />
    </group>
  )
}

// ── Well ─────────────────────────────────────────────────────────────────────

function Well({ position }: { position: [number, number, number] }) {
  const stoneMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b6252', roughness: 0.95 }), [])
  const woodMat  = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5c3d1e', roughness: 0.85 }), [])
  const ropeMat  = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8b7355', roughness: 0.9 }), [])
  const waterMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1a4a6e', roughness: 0.1, metalness: 0.3 }), [])

  return (
    <group position={position}>
      {/* Stone base */}
      <mesh material={stoneMat} castShadow receiveShadow>
        <cylinderGeometry args={[0.55, 0.6, 0.5, 12]} />
      </mesh>
      {/* Water surface */}
      <mesh position={[0, 0.12, 0]} material={waterMat}>
        <circleGeometry args={[0.42, 12]} />
      </mesh>
      {/* Wooden cross-beam */}
      <mesh position={[-0.55, 0.72, 0]} material={woodMat} castShadow>
        <cylinderGeometry args={[0.04, 0.05, 1.44, 6]} />
      </mesh>
      <mesh position={[0.55, 0.72, 0]} material={woodMat} castShadow>
        <cylinderGeometry args={[0.04, 0.05, 1.44, 6]} />
      </mesh>
      <mesh position={[0, 0.72, 0]} rotation={[0, 0, Math.PI / 2]} material={woodMat} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 1.1, 6]} />
      </mesh>
      {/* Rope */}
      <mesh position={[0, 0.55, 0]} material={ropeMat}>
        <cylinderGeometry args={[0.015, 0.015, 0.34, 4]} />
      </mesh>
    </group>
  )
}

// ── Fence segment ────────────────────────────────────────────────────────────

function FenceSegment({ start, end }: { start: [number, number, number]; end: [number, number, number] }) {
  const woodMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b4c2e', roughness: 0.9 }), [])
  const [x1, , z1] = start
  const [x2, , z2] = end
  const cx = (x1 + x2) / 2
  const cz = (z1 + z2) / 2
  const len = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2)
  const angle = Math.atan2(z2 - z1, x2 - x1)

  return (
    <group position={[cx, 0, cz]} rotation={[0, -angle, 0]}>
      {/* Top rail */}
      <mesh position={[0, 0.65, 0]} material={woodMat}>
        <boxGeometry args={[len, 0.06, 0.06]} />
      </mesh>
      {/* Bottom rail */}
      <mesh position={[0, 0.3, 0]} material={woodMat}>
        <boxGeometry args={[len, 0.06, 0.06]} />
      </mesh>
      {/* Posts */}
      {Array.from({ length: Math.ceil(len / 0.5) + 1 }, (_, i) => {
        const t = len > 0 ? i / (Math.ceil(len / 0.5)) : 0
        return (
          <mesh key={i} position={[-len / 2 + t * len, 0.4, 0]} material={woodMat}>
            <boxGeometry args={[0.07, 0.8, 0.07]} />
          </mesh>
        )
      })}
    </group>
  )
}

// ── Coin pile decoration ──────────────────────────────────────────────────────

function CoinPile({ position }: { position: [number, number, number] }) {
  const coinMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#c9a84c', emissive: '#8b6914', emissiveIntensity: 0.2, metalness: 0.7, roughness: 0.3
  }), [])

  const coins = useMemo(() => Array.from({ length: 5 }, (_, i) => ({
    x: (Math.random() - 0.5) * 0.18,
    z: (Math.random() - 0.5) * 0.18,
    r: Math.random() * Math.PI,
    s: 0.7 + Math.random() * 0.5,
  })), [])

  return (
    <group position={position}>
      {coins.map((c, i) => (
        <mesh key={i} position={[c.x, 0.02 + i * 0.014, c.z]} rotation={[Math.PI / 2, c.r, 0]} material={coinMat} scale={c.s}>
          <cylinderGeometry args={[0.06, 0.06, 0.012, 12]} />
        </mesh>
      ))}
    </group>
  )
}

// ── Sign board ────────────────────────────────────────────────────────────────

function SignBoard({ position, text }: { position: [number, number, number]; text: string }) {
  const woodMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5c3d1e', roughness: 0.85 }), [])
  return (
    <group position={position}>
      {/* Post */}
      <mesh position={[0, 0.5, 0]} material={woodMat}><cylinderGeometry args={[0.04, 0.04, 1, 6]} /></mesh>
      {/* Board */}
      <mesh position={[0, 1.05, 0]} material={woodMat}><boxGeometry args={[0.7, 0.28, 0.06]} /></mesh>
    </group>
  )
}

// ── Assembled environment ─────────────────────────────────────────────────────

export function EnvironmentProps() {
  return (
    <group>
      {/* Trees around perimeter */}
      <Tree position={[-8, 0, -6]} />
      <Tree position={[-9, 0, 2]} />
      <Tree position={[-7, 0, -1]} />
      <Tree position={[8, 0, -6]} />
      <Tree position={[9, 0, 1]} />
      <Tree position={[7, 0, 5]} />
      <Tree position={[3, 0, 8]} />
      <Tree position={[-3, 0, 8]} />
      <Tree position={[-6, 0, 7]} />
      <Tree position={[6, 0, 7]} />

      {/* Market area props */}
      <Barrel position={[-5.2, 0.21, 1.8]} />
      <Barrel position={[-5.8, 0.21, 2.2]} rotation={0.5} />
      <Barrel position={[-5.2, 0.21, 4.2]} />
      <Crate position={[-2.8, 0.2, 1.9]} />
      <Crate position={[-3.3, 0.2, 1.9]} />
      <Crate position={[-3.05, 0.6, 1.9]} />
      <CoinPile position={[-4.1, 0, 2.1]} />

      {/* Treasury area */}
      <Crate position={[2.8, 0.2, 4.2]} />
      <Barrel position={[5.8, 0.21, 4.2]} />
      <CoinPile position={[3.5, 0, 4.1]} />
      <CoinPile position={[5.5, 0, 2.2]} />

      {/* Trade caravan area */}
      <Barrel position={[7.2, 0.21, -2]} />
      <Barrel position={[7.8, 0.21, -2.6]} rotation={1} />
      <Crate position={[6.5, 0.2, -4.5]} />
      <Crate position={[7.0, 0.2, -4.5]} />
      <Crate position={[6.75, 0.6, -4.5]} />

      {/* Home area */}
      <Barrel position={[-6.2, 0.21, -1.5]} />
      <Crate position={[-7.2, 0.2, -4.5]} />

      {/* Central square well */}
      <Well position={[0, 0, 0]} />

      {/* Lantern posts */}
      <LanternPost position={[-2, 0, 0]} />
      <LanternPost position={[2, 0, 0]} />
      <LanternPost position={[0, 0, -2]} />
      <LanternPost position={[0, 0, 2]} />
      <LanternPost position={[-4, 0, -2]} />
      <LanternPost position={[4, 0, -2]} />
      <LanternPost position={[-3, 0, 4.5]} />
      <LanternPost position={[3, 0, 4.5]} />

      {/* Fence border segments */}
      <FenceSegment start={[-10, 0, 9]} end={[10, 0, 9]} />
      <FenceSegment start={[-10, 0, -8]} end={[10, 0, -8]} />
      <FenceSegment start={[-10, 0, -8]} end={[-10, 0, 9]} />
      <FenceSegment start={[10, 0, -8]} end={[10, 0, 9]} />

      {/* Sign boards */}
      <SignBoard position={[-3.2, 0, 2.6]} text="Market" />
      <SignBoard position={[3.2, 0, 2.6]} text="Treasury" />
      <SignBoard position={[0.5, 0, -3]} text="Guild Hall" />
    </group>
  )
}

// ── Atmosphere ───────────────────────────────────────────────────────────────

export function Atmosphere() {
  return (
    <>
      <Sky
        distance={450000}
        sunPosition={[0.3, 0.08, -1]}
        inclination={0.62}
        azimuth={0.28}
        turbidity={12}
        rayleigh={0.4}
      />
      <Stars radius={80} depth={50} count={4000} factor={4} saturation={0} fade speed={0.4} />
      <ambientLight intensity={0.35} color="#c4a882" />
      <hemisphereLight args={['#4a3520', '#1a1008', 0.28]} />
      <directionalLight
        position={[8, 18, 6]}
        intensity={1.6}
        color="#ffe0a0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={70}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
      />
    </>
  )
}
