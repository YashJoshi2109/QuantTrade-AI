'use client'

import { useEffect, useRef, ReactNode } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger)
}

// Animated Card with 3D tilt effect
interface AnimatedCardProps {
  children: ReactNode
  className?: string
  tiltIntensity?: number
  glowColor?: string
}

export function AnimatedCard({ 
  children, 
  className = '', 
  tiltIntensity = 10,
  glowColor = 'rgba(59, 130, 246, 0.3)'
}: AnimatedCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!cardRef.current) return
    const card = cardRef.current

    const handleMove = (e: MouseEvent) => {
      const rect = card.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      
      const tiltX = ((y - centerY) / centerY) * tiltIntensity
      const tiltY = ((centerX - x) / centerX) * tiltIntensity

      gsap.to(card, {
        rotateX: tiltX,
        rotateY: tiltY,
        transformPerspective: 1000,
        boxShadow: `0 20px 40px ${glowColor}`,
        duration: 0.4,
        ease: 'power2.out',
      })
    }

    const handleLeave = () => {
      gsap.to(card, {
        rotateX: 0,
        rotateY: 0,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)',
        duration: 0.6,
        ease: 'elastic.out(1, 0.5)',
      })
    }

    card.addEventListener('mousemove', handleMove)
    card.addEventListener('mouseleave', handleLeave)

    return () => {
      card.removeEventListener('mousemove', handleMove)
      card.removeEventListener('mouseleave', handleLeave)
    }
  }, [tiltIntensity, glowColor])

  return (
    <div 
      ref={cardRef} 
      className={`transform-gpu transition-transform ${className}`}
      style={{ transformStyle: 'preserve-3d' }}
    >
      {children}
    </div>
  )
}

// Fade In animation wrapper
interface FadeInProps {
  children: ReactNode
  direction?: 'up' | 'down' | 'left' | 'right'
  delay?: number
  duration?: number
  className?: string
}

export function FadeIn({ 
  children, 
  direction = 'up', 
  delay = 0,
  duration = 0.8,
  className = '' 
}: FadeInProps) {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!elementRef.current) return

    const directions: Record<string, { x?: number; y?: number }> = {
      up: { y: 60 },
      down: { y: -60 },
      left: { x: -60 },
      right: { x: 60 },
    }

    const animation = gsap.fromTo(
      elementRef.current,
      { opacity: 0, ...directions[direction] },
      {
        opacity: 1,
        x: 0,
        y: 0,
        duration,
        delay,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: elementRef.current,
          start: 'top 90%',
          toggleActions: 'play none none reverse',
        },
      }
    )

    return () => {
      animation.scrollTrigger?.kill()
      animation.kill()
    }
  }, [direction, delay, duration])

  return (
    <div ref={elementRef} className={className}>
      {children}
    </div>
  )
}

// Stagger Children animation
interface StaggerProps {
  children: ReactNode
  staggerTime?: number
  className?: string
}

export function StaggerChildren({ children, staggerTime = 0.1, className = '' }: StaggerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const children = containerRef.current.children

    gsap.set(children, { opacity: 0, y: 40 })

    const animation = gsap.to(children, {
      opacity: 1,
      y: 0,
      duration: 0.6,
      stagger: staggerTime,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: containerRef.current,
        start: 'top 85%',
        toggleActions: 'play none none reverse',
      },
    })

    return () => {
      animation.scrollTrigger?.kill()
      animation.kill()
    }
  }, [staggerTime])

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  )
}

// Animated Counter
interface CounterProps {
  value: number
  prefix?: string
  suffix?: string
  duration?: number
  className?: string
}

export function AnimatedCounter({ 
  value, 
  prefix = '', 
  suffix = '', 
  duration = 2,
  className = '' 
}: CounterProps) {
  const counterRef = useRef<HTMLSpanElement>(null)
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (!counterRef.current || hasAnimated.current) return

    const element = counterRef.current
    const obj = { value: 0 }

    const animation = gsap.to(obj, {
      value,
      duration,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: element,
        start: 'top 90%',
        once: true,
      },
      onUpdate: () => {
        element.textContent = `${prefix}${Math.round(obj.value).toLocaleString()}${suffix}`
      },
      onComplete: () => {
        hasAnimated.current = true
      },
    })

    return () => {
      animation.scrollTrigger?.kill()
      animation.kill()
    }
  }, [value, prefix, suffix, duration])

  return <span ref={counterRef} className={className}>{prefix}0{suffix}</span>
}

// Text Reveal Animation
interface TextRevealProps {
  children: string
  className?: string
  delay?: number
}

export function TextReveal({ children, className = '', delay = 0 }: TextRevealProps) {
  const textRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!textRef.current) return

    gsap.set(textRef.current, {
      opacity: 0,
      y: 100,
      clipPath: 'inset(100% 0% 0% 0%)',
    })

    const animation = gsap.to(textRef.current, {
      opacity: 1,
      y: 0,
      clipPath: 'inset(0% 0% 0% 0%)',
      duration: 1.2,
      delay,
      ease: 'expo.out',
      scrollTrigger: {
        trigger: textRef.current,
        start: 'top 85%',
        toggleActions: 'play none none reverse',
      },
    })

    return () => {
      animation.scrollTrigger?.kill()
      animation.kill()
    }
  }, [delay])

  return (
    <div ref={textRef} className={className}>
      {children}
    </div>
  )
}

// Magnetic Button
interface MagneticButtonProps {
  children: ReactNode
  className?: string
  intensity?: number
  onClick?: () => void
}

export function MagneticButton({ 
  children, 
  className = '', 
  intensity = 0.4,
  onClick 
}: MagneticButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!buttonRef.current) return
    const button = buttonRef.current

    const handleMove = (e: MouseEvent) => {
      const rect = button.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const deltaX = (e.clientX - centerX) * intensity
      const deltaY = (e.clientY - centerY) * intensity

      gsap.to(button, {
        x: deltaX,
        y: deltaY,
        duration: 0.3,
        ease: 'power2.out',
      })
    }

    const handleLeave = () => {
      gsap.to(button, {
        x: 0,
        y: 0,
        duration: 0.6,
        ease: 'elastic.out(1, 0.5)',
      })
    }

    button.addEventListener('mousemove', handleMove)
    button.addEventListener('mouseleave', handleLeave)

    return () => {
      button.removeEventListener('mousemove', handleMove)
      button.removeEventListener('mouseleave', handleLeave)
    }
  }, [intensity])

  return (
    <button ref={buttonRef} className={className} onClick={onClick}>
      {children}
    </button>
  )
}

// Parallax Container
interface ParallaxProps {
  children: ReactNode
  speed?: number
  className?: string
}

export function Parallax({ children, speed = 0.5, className = '' }: ParallaxProps) {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!elementRef.current) return

    const animation = gsap.to(elementRef.current, {
      y: () => window.innerHeight * speed * -0.5,
      ease: 'none',
      scrollTrigger: {
        trigger: elementRef.current,
        start: 'top bottom',
        end: 'bottom top',
        scrub: 1,
      },
    })

    return () => {
      animation.scrollTrigger?.kill()
      animation.kill()
    }
  }, [speed])

  return (
    <div ref={elementRef} className={className}>
      {children}
    </div>
  )
}

// Glow Effect
interface GlowProps {
  children: ReactNode
  color?: string
  className?: string
}

export function GlowEffect({ children, color = 'rgba(59, 130, 246, 0.5)', className = '' }: GlowProps) {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!elementRef.current) return

    const animation = gsap.to(elementRef.current, {
      boxShadow: `0 0 40px ${color}`,
      repeat: -1,
      yoyo: true,
      duration: 2,
      ease: 'sine.inOut',
    })

    return () => animation.kill()
  }, [color])

  return (
    <div ref={elementRef} className={className}>
      {children}
    </div>
  )
}

// Animated Gradient Background
export function AnimatedGradient({ className = '' }: { className?: string }) {
  const gradientRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!gradientRef.current) return

    gsap.to(gradientRef.current, {
      backgroundPosition: '200% 200%',
      duration: 10,
      repeat: -1,
      ease: 'none',
    })
  }, [])

  return (
    <div
      ref={gradientRef}
      className={`absolute inset-0 opacity-30 ${className}`}
      style={{
        background: 'linear-gradient(45deg, #1e3a8a, #3b82f6, #8b5cf6, #1e3a8a)',
        backgroundSize: '400% 400%',
      }}
    />
  )
}

// Floating Animation
interface FloatingProps {
  children: ReactNode
  amplitude?: number
  duration?: number
  className?: string
}

export function Floating({ children, amplitude = 10, duration = 3, className = '' }: FloatingProps) {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!elementRef.current) return

    const animation = gsap.to(elementRef.current, {
      y: amplitude,
      duration,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    })

    return () => animation.kill()
  }, [amplitude, duration])

  return (
    <div ref={elementRef} className={className}>
      {children}
    </div>
  )
}
