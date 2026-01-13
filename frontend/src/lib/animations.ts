/**
 * GSAP Animation Utilities
 * Reusable animation configurations and effects
 */
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// Register GSAP plugins
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger)
}

// Animation presets
export const easings = {
  smooth: 'power2.out',
  bounce: 'elastic.out(1, 0.5)',
  snap: 'power4.out',
  gentle: 'power1.inOut',
  dramatic: 'expo.out',
  spring: 'back.out(1.7)',
}

// Fade in from bottom animation
export const fadeInUp = (element: HTMLElement | string, delay = 0) => {
  return gsap.fromTo(
    element,
    { opacity: 0, y: 60 },
    { opacity: 1, y: 0, duration: 0.8, delay, ease: easings.smooth }
  )
}

// Fade in from left animation
export const fadeInLeft = (element: HTMLElement | string, delay = 0) => {
  return gsap.fromTo(
    element,
    { opacity: 0, x: -60 },
    { opacity: 1, x: 0, duration: 0.8, delay, ease: easings.smooth }
  )
}

// Fade in from right animation
export const fadeInRight = (element: HTMLElement | string, delay = 0) => {
  return gsap.fromTo(
    element,
    { opacity: 0, x: 60 },
    { opacity: 1, x: 0, duration: 0.8, delay, ease: easings.smooth }
  )
}

// Scale in animation
export const scaleIn = (element: HTMLElement | string, delay = 0) => {
  return gsap.fromTo(
    element,
    { opacity: 0, scale: 0.8 },
    { opacity: 1, scale: 1, duration: 0.6, delay, ease: easings.spring }
  )
}

// Stagger children animation
export const staggerIn = (
  parent: HTMLElement | string,
  childSelector: string,
  staggerTime = 0.1
) => {
  return gsap.fromTo(
    `${parent} ${childSelector}`,
    { opacity: 0, y: 40 },
    {
      opacity: 1,
      y: 0,
      duration: 0.6,
      stagger: staggerTime,
      ease: easings.smooth,
    }
  )
}

// Magnetic hover effect
export const magneticHover = (element: HTMLElement, intensity = 0.3) => {
  const handleMouseMove = (e: MouseEvent) => {
    const rect = element.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const deltaX = (e.clientX - centerX) * intensity
    const deltaY = (e.clientY - centerY) * intensity

    gsap.to(element, {
      x: deltaX,
      y: deltaY,
      duration: 0.3,
      ease: easings.gentle,
    })
  }

  const handleMouseLeave = () => {
    gsap.to(element, {
      x: 0,
      y: 0,
      duration: 0.5,
      ease: easings.spring,
    })
  }

  element.addEventListener('mousemove', handleMouseMove)
  element.addEventListener('mouseleave', handleMouseLeave)

  return () => {
    element.removeEventListener('mousemove', handleMouseMove)
    element.removeEventListener('mouseleave', handleMouseLeave)
  }
}

// Parallax scroll effect
export const parallaxScroll = (element: HTMLElement | string, speed = 0.5) => {
  return gsap.to(element, {
    y: () => ScrollTrigger.maxScroll(window) * speed * -1,
    ease: 'none',
    scrollTrigger: {
      trigger: element,
      start: 'top bottom',
      end: 'bottom top',
      scrub: true,
    },
  })
}

// Text reveal animation (split by characters)
export const textReveal = (element: HTMLElement | string, delay = 0) => {
  const tl = gsap.timeline()
  
  tl.fromTo(
    element,
    { 
      opacity: 0, 
      y: 100,
      clipPath: 'inset(100% 0% 0% 0%)'
    },
    { 
      opacity: 1, 
      y: 0,
      clipPath: 'inset(0% 0% 0% 0%)',
      duration: 1,
      delay,
      ease: easings.dramatic
    }
  )
  
  return tl
}

// Counter animation
export const animateCounter = (
  element: HTMLElement,
  endValue: number,
  duration = 2,
  prefix = '',
  suffix = ''
) => {
  const obj = { value: 0 }
  
  return gsap.to(obj, {
    value: endValue,
    duration,
    ease: easings.smooth,
    onUpdate: () => {
      element.textContent = `${prefix}${Math.round(obj.value).toLocaleString()}${suffix}`
    },
  })
}

// Scroll-triggered fade in
export const scrollFadeIn = (element: HTMLElement | string, direction: 'up' | 'down' | 'left' | 'right' = 'up') => {
  const directions = {
    up: { y: 80 },
    down: { y: -80 },
    left: { x: -80 },
    right: { x: 80 },
  }

  return gsap.fromTo(
    element,
    { opacity: 0, ...directions[direction] },
    {
      opacity: 1,
      x: 0,
      y: 0,
      duration: 1,
      ease: easings.smooth,
      scrollTrigger: {
        trigger: element,
        start: 'top 85%',
        end: 'bottom 15%',
        toggleActions: 'play none none reverse',
      },
    }
  )
}

// Hover scale effect
export const hoverScale = (element: HTMLElement, scale = 1.05) => {
  const handleMouseEnter = () => {
    gsap.to(element, {
      scale,
      duration: 0.3,
      ease: easings.smooth,
    })
  }

  const handleMouseLeave = () => {
    gsap.to(element, {
      scale: 1,
      duration: 0.3,
      ease: easings.smooth,
    })
  }

  element.addEventListener('mouseenter', handleMouseEnter)
  element.addEventListener('mouseleave', handleMouseLeave)

  return () => {
    element.removeEventListener('mouseenter', handleMouseEnter)
    element.removeEventListener('mouseleave', handleMouseLeave)
  }
}

// Glow pulse effect
export const glowPulse = (element: HTMLElement | string, color = 'rgba(59, 130, 246, 0.5)') => {
  return gsap.to(element, {
    boxShadow: `0 0 30px ${color}`,
    repeat: -1,
    yoyo: true,
    duration: 1.5,
    ease: 'sine.inOut',
  })
}

// Line draw animation
export const drawLine = (element: SVGPathElement | string) => {
  return gsap.fromTo(
    element,
    { strokeDashoffset: 1000, strokeDasharray: 1000 },
    {
      strokeDashoffset: 0,
      duration: 2,
      ease: easings.smooth,
      scrollTrigger: {
        trigger: element,
        start: 'top 80%',
      },
    }
  )
}

// Morph number animation
export const morphNumber = (
  element: HTMLElement,
  from: number,
  to: number,
  duration = 1.5,
  formatter: (val: number) => string = (val) => val.toFixed(2)
) => {
  const obj = { value: from }
  
  return gsap.to(obj, {
    value: to,
    duration,
    ease: easings.smooth,
    onUpdate: () => {
      element.textContent = formatter(obj.value)
    },
  })
}

// Card 3D tilt effect
export const tilt3D = (element: HTMLElement, maxTilt = 15) => {
  const handleMouseMove = (e: MouseEvent) => {
    const rect = element.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    
    const tiltX = ((y - centerY) / centerY) * maxTilt
    const tiltY = ((centerX - x) / centerX) * maxTilt

    gsap.to(element, {
      rotateX: tiltX,
      rotateY: tiltY,
      transformPerspective: 1000,
      duration: 0.3,
      ease: easings.gentle,
    })
  }

  const handleMouseLeave = () => {
    gsap.to(element, {
      rotateX: 0,
      rotateY: 0,
      duration: 0.5,
      ease: easings.spring,
    })
  }

  element.addEventListener('mousemove', handleMouseMove)
  element.addEventListener('mouseleave', handleMouseLeave)

  return () => {
    element.removeEventListener('mousemove', handleMouseMove)
    element.removeEventListener('mouseleave', handleMouseLeave)
  }
}
