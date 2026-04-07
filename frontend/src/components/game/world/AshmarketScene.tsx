'use client'

import { Suspense, useRef, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

import Buildings from './BuildingMeshes'
import { NPCSystem } from './Characters'
import Player from './Player'
import { Ground, EnvironmentProps, Atmosphere } from './Environment'
import { FXLayer, useFXSystem } from './FXSystem'

// ── Isometric camera controller ───────────────────────────────────────────────

const CAM_OFFSET = new THREE.Vector3(0, 16, 14)
const WORLD_BOUNDS = { minX: -11, maxX: 11, minZ: -10, maxZ: 8 }
const PAN_SPEED = 10
const ZOOM_MIN = 10
const ZOOM_MAX = 26

function IsometricCamera({ target }: { target: THREE.Vector3 }) {
  const { camera, gl } = useThree()
  const panTarget = useRef(new THREE.Vector3())
  const zoomTarget = useRef(16)
  const tick = useRef(0)

  useEffect(() => {
    camera.position.copy(CAM_OFFSET)
    camera.lookAt(0, 0, 0)
  }, [camera])

  useFrame((_, delta) => {
    tick.current += delta

    // Smooth follow player (loose follow)
    panTarget.current.lerp(new THREE.Vector3(
      Math.max(WORLD_BOUNDS.minX, Math.min(WORLD_BOUNDS.maxX, target.x * 0.6)),
      0,
      Math.max(WORLD_BOUNDS.minZ, Math.min(WORLD_BOUNDS.maxZ, target.z * 0.6)),
    ), delta * 2)

    const zoom = THREE.MathUtils.lerp(camera.position.distanceTo(panTarget.current), zoomTarget.current, delta * 4)

    const desired = panTarget.current.clone().add(
      CAM_OFFSET.clone().normalize().multiplyScalar(zoomTarget.current)
    )
    camera.position.lerp(desired, delta * 3)
    camera.lookAt(panTarget.current)
  })

  // Scroll to zoom
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      zoomTarget.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomTarget.current + e.deltaY * 0.015))
    }
    gl.domElement.addEventListener('wheel', onWheel, { passive: true })
    return () => gl.domElement.removeEventListener('wheel', onWheel)
  }, [gl])

  return null
}

// ── Ambient firefly particles ─────────────────────────────────────────────────

function Fireflies({ count = 35 }) {
  const ref = useRef<THREE.Points>(null!)
  const basePos = useRef(new Float32Array(count * 3).map(() => (Math.random() - 0.5) * 16))

  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.getElapsedTime()
    for (let i = 0; i < count; i++) {
      ref.current.geometry.attributes.position!.setY(
        i, basePos.current[i * 3 + 1]! + Math.sin(t * 0.9 + i * 0.5) * 0.35
      )
    }
    ref.current.geometry.attributes.position!.needsUpdate = true
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[basePos.current, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.07} color="#fde68a" transparent opacity={0.7} sizeAttenuation />
    </points>
  )
}

// ── Main scene composition ────────────────────────────────────────────────────

interface SceneContentProps {
  completedChapters: string[]
  availableBuildings: string[]
  onBuildingClick: (id: string) => void
  onNPCClick: (buildingId: string) => void
  onNearBuilding: (id: string | null) => void
  fxRef: React.MutableRefObject<ReturnType<typeof useFXSystem> | null>
}

function SceneContent({
  completedChapters, availableBuildings,
  onBuildingClick, onNPCClick, onNearBuilding, fxRef
}: SceneContentProps) {
  const playerPos = useRef(new THREE.Vector3())
  const fx = useFXSystem()

  // Expose FX to parent
  useEffect(() => { fxRef.current = fx }, [fx, fxRef])

  function handlePlayerPosUpdate(pos: THREE.Vector3) {
    playerPos.current.copy(pos)
  }

  return (
    <>
      <Atmosphere />
      <Fireflies />
      <Ground />
      <EnvironmentProps />

      <Buildings
        completedChapters={completedChapters}
        onBuildingClick={onBuildingClick}
      />

      <NPCSystem
        availableBuildings={availableBuildings}
        onNPCClick={onNPCClick}
      />

      <Player
        onNearBuilding={onNearBuilding}
        onPositionUpdate={handlePlayerPosUpdate}
      />

      <FXLayer {...fx} />

      <ContactShadows position={[0, 0.005, 0]} opacity={0.55} scale={35} blur={2} far={10} />

      <IsometricCamera target={playerPos.current} />
    </>
  )
}

// ── Exported canvas ───────────────────────────────────────────────────────────

interface AshmarketSceneProps {
  completedChapters: string[]
  availableBuildings: string[]
  onBuildingClick: (id: string) => void
  onNPCClick: (buildingId: string) => void
  onNearBuilding: (id: string | null) => void
  fxRef: React.MutableRefObject<ReturnType<typeof useFXSystem> | null>
}

export default function AshmarketScene(props: AshmarketSceneProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 16, 14], fov: 44, near: 0.1, far: 300 }}
      gl={{ antialias: true, outputColorSpace: THREE.SRGBColorSpace }}
      className="w-full h-full"
    >
      <Suspense fallback={null}>
        <SceneContent {...props} />
      </Suspense>
    </Canvas>
  )
}
