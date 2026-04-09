'use client'

import { useRef, useState, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PlayerMesh } from './Characters'

const BUILDING_POSITIONS: Record<string, THREE.Vector3> = {
  market_stall:  new THREE.Vector3(-4, 0, 3.5),
  treasury:      new THREE.Vector3( 4, 0, 3.5),
  guild_hall:    new THREE.Vector3( 0, 0,-4.5),
  home:          new THREE.Vector3(-5.5, 0,-3.5),
  trade_caravan: new THREE.Vector3( 5.5, 0,-3.5),
  counting_house: new THREE.Vector3(8.5, 0, 1.5),
  trading_post:   new THREE.Vector3(-8.5, 0, 1.5),
  town_hall:      new THREE.Vector3(3.5, 0, -7.5),
  apothecary:     new THREE.Vector3(-3.5, 0, -7.5),
}
const INTERACT_RADIUS = 3.2
const MOVE_SPEED = 4.5
const GROUND_Y = 0

interface PlayerProps {
  onNearBuilding?: (id: string | null) => void
  onPositionUpdate?: (pos: THREE.Vector3) => void
}

export default function Player({ onNearBuilding, onPositionUpdate }: PlayerProps) {
  const groupRef = useRef<THREE.Group>(null!)
  const [target, setTarget] = useState<THREE.Vector3 | null>(null)
  const [moving, setMoving] = useState(false)
  const [nearBuilding, setNearBuilding] = useState<string | null>(null)
  const { gl, camera } = useThree()
  
  const keys = useRef<Record<string, boolean>>({})

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { keys.current[e.code] = true }
    const handleKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  useFrame((_, delta) => {
    if (!groupRef.current) return
    const pos = groupRef.current.position

    const kb = keys.current
    let dx = 0
    let dz = 0

    if (kb['KeyW'] || kb['ArrowUp']) dz -= 1
    if (kb['KeyS'] || kb['ArrowDown']) dz += 1
    if (kb['KeyA'] || kb['ArrowLeft']) dx -= 1
    if (kb['KeyD'] || kb['ArrowRight']) dx += 1

    let isKbMoving = false
    if (dx !== 0 || dz !== 0) {
      isKbMoving = true
      setTarget(null) // cancel point-and-click if manual movement
      
      const dir = new THREE.Vector3(dx, 0, dz).normalize()
      const nextX = pos.x + dir.x * MOVE_SPEED * delta
      const nextZ = pos.z + dir.z * MOVE_SPEED * delta
      
      pos.x = Math.max(-10, Math.min(10, nextX))
      pos.z = Math.max(-8, Math.min(9, nextZ))

      const angle = Math.atan2(dir.x, dir.z)
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, angle, delta * 12)
    }

    if (target) {
      const flat = new THREE.Vector3(pos.x, 0, pos.z)
      const flatTarget = new THREE.Vector3(target.x, 0, target.z)
      const dist = flat.distanceTo(flatTarget)

      if (dist > 0.12) {
        const dir = flatTarget.clone().sub(flat).normalize()
        pos.x += dir.x * MOVE_SPEED * delta
        pos.z += dir.z * MOVE_SPEED * delta

        const angle = Math.atan2(dir.x, dir.z)
        groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, angle, delta * 12)
        setMoving(true)
      } else {
        setTarget(null)
      }
    }

    if (!isKbMoving && !target && moving) {
      setMoving(false)
    } else if (isKbMoving && !moving) {
      setMoving(true)
    }

    onPositionUpdate?.(pos)

    // Check building proximity
    let nearest: string | null = null
    let minDist = INTERACT_RADIUS
    for (const [id, bpos] of Object.entries(BUILDING_POSITIONS)) {
      const d = pos.distanceTo(new THREE.Vector3(bpos.x, 0, bpos.z))
      if (d < minDist) { minDist = d; nearest = id }
    }

    if (nearest !== nearBuilding) {
      setNearBuilding(nearest)
      onNearBuilding?.(nearest)
    }
  })

  // Ground-plane raycasting for click-to-move
  useEffect(() => {
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const raycaster = new THREE.Raycaster()
    const mouseVec = new THREE.Vector2()
    const hitPoint = new THREE.Vector3()

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return
      const canvas = gl.domElement
      const rect = canvas.getBoundingClientRect()
      mouseVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouseVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouseVec, camera)
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        setTarget(new THREE.Vector3(
          Math.max(-10, Math.min(10, hitPoint.x)),
          GROUND_Y,
          Math.max(-8, Math.min(9, hitPoint.z))
        ))
      }
    }

    gl.domElement.addEventListener('pointerdown', onPointerDown)
    return () => gl.domElement.removeEventListener('pointerdown', onPointerDown)
  }, [gl, camera])

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      <PlayerMesh moving={moving} />
      {/* Shadow disc */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.28, 14]} />
        <meshStandardMaterial color="#000" transparent opacity={0.22} />
      </mesh>
    </group>
  )
}
