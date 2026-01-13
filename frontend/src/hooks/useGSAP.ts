'use client'

import { useEffect, useRef, useCallback } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// Register plugins on client side only
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger)
}

// Main GSAP hook for component animations
export function useGSAP(
  animationFn: (ctx: gsap.Context) => void,
  deps: any[] = []
) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const ctx = gsap.context(() => {
      animationFn(ctx as any)
    }, containerRef)

    return () => ctx.revert()
  }, deps)

  return containerRef
}

// Hook for scroll-triggered animations
export function useScrollAnimation(
  options: {
    trigger?: string
    start?: string
    end?: string
    scrub?: boolean | number
    pin?: boolean
    markers?: boolean
  } = {}
) {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !elementRef.current) return

    const element = elementRef.current

    const animation = gsap.fromTo(
      element,
      { opacity: 0, y: 60 },
      {
        opacity: 1,
        y: 0,
        duration: 1,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: options.trigger || element,
          start: options.start || 'top 80%',
          end: options.end || 'bottom 20%',
          scrub: options.scrub || false,
          pin: options.pin || false,
          markers: options.markers || false,
          toggleActions: 'play none none reverse',
        },
      }
    )

    return () => {
      animation.scrollTrigger?.kill()
      animation.kill()
    }
  }, [options])

  return elementRef
}

// Hook for staggered children animations
export function useStaggerAnimation(
  childSelector: string = ':scope > *',
  staggerTime: number = 0.1
) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return

    const children = containerRef.current.querySelectorAll(childSelector)

    const animation = gsap.fromTo(
      children,
      { opacity: 0, y: 40 },
      {
        opacity: 1,
        y: 0,
        duration: 0.6,
        stagger: staggerTime,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top 80%',
          toggleActions: 'play none none reverse',
        },
      }
    )

    return () => {
      animation.scrollTrigger?.kill()
      animation.kill()
    }
  }, [childSelector, staggerTime])

  return containerRef
}

// Hook for hover animations
export function useHoverAnimation(
  hoverState: gsap.TweenVars = { scale: 1.05 },
  normalState: gsap.TweenVars = { scale: 1 }
) {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !elementRef.current) return

    const element = elementRef.current

    const handleEnter = () => {
      gsap.to(element, {
        ...hoverState,
        duration: 0.3,
        ease: 'power2.out',
      })
    }

    const handleLeave = () => {
      gsap.to(element, {
        ...normalState,
        duration: 0.3,
        ease: 'power2.out',
      })
    }

    element.addEventListener('mouseenter', handleEnter)
    element.addEventListener('mouseleave', handleLeave)

    return () => {
      element.removeEventListener('mouseenter', handleEnter)
      element.removeEventListener('mouseleave', handleLeave)
    }
  }, [hoverState, normalState])

  return elementRef
}

// Hook for magnetic cursor effect
export function useMagnetic(intensity: number = 0.3) {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !elementRef.current) return

    const element = elementRef.current

    const handleMove = (e: MouseEvent) => {
      const rect = element.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const deltaX = (e.clientX - centerX) * intensity
      const deltaY = (e.clientY - centerY) * intensity

      gsap.to(element, {
        x: deltaX,
        y: deltaY,
        duration: 0.3,
        ease: 'power2.out',
      })
    }

    const handleLeave = () => {
      gsap.to(element, {
        x: 0,
        y: 0,
        duration: 0.5,
        ease: 'elastic.out(1, 0.5)',
      })
    }

    element.addEventListener('mousemove', handleMove)
    element.addEventListener('mouseleave', handleLeave)

    return () => {
      element.removeEventListener('mousemove', handleMove)
      element.removeEventListener('mouseleave', handleLeave)
    }
  }, [intensity])

  return elementRef
}

// Hook for parallax effect
export function useParallax(speed: number = 0.5) {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !elementRef.current) return

    const animation = gsap.to(elementRef.current, {
      y: () => window.innerHeight * speed * -1,
      ease: 'none',
      scrollTrigger: {
        trigger: elementRef.current,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    })

    return () => {
      animation.scrollTrigger?.kill()
      animation.kill()
    }
  }, [speed])

  return elementRef
}

// Hook for counter animation
export function useCounter(
  endValue: number,
  duration: number = 2,
  prefix: string = '',
  suffix: string = ''
) {
  const elementRef = useRef<HTMLSpanElement>(null)
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !elementRef.current || hasAnimated.current) return

    const element = elementRef.current
    const obj = { value: 0 }

    const animation = gsap.to(obj, {
      value: endValue,
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
  }, [endValue, duration, prefix, suffix])

  return elementRef
}

// Hook for text reveal animation
export function useTextReveal() {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !elementRef.current) return

    const element = elementRef.current

    gsap.set(element, { 
      opacity: 0, 
      y: 50,
      clipPath: 'inset(100% 0% 0% 0%)'
    })

    const animation = gsap.to(element, {
      opacity: 1,
      y: 0,
      clipPath: 'inset(0% 0% 0% 0%)',
      duration: 1,
      ease: 'expo.out',
      scrollTrigger: {
        trigger: element,
        start: 'top 85%',
        toggleActions: 'play none none reverse',
      },
    })

    return () => {
      animation.scrollTrigger?.kill()
      animation.kill()
    }
  }, [])

  return elementRef
}
