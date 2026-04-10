import { gameApi } from '@/lib/game-api'

let audioCtx: AudioContext | null = null
let currentVoice: HTMLAudioElement | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    audioCtx = new Ctx()
  }
  return audioCtx
}

export async function playGameSfx(kind: 'loading' | 'mission_complete' | 'click' | 'coins' | 'welcome' | 'error' | 'ambient'): Promise<void> {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') await ctx.resume()

  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)

  if (kind === 'coins') {
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(1200, now)
    osc.frequency.setValueAtTime(1600, now + 0.05)
    osc.frequency.setValueAtTime(1400, now + 0.1)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(0.05, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15)
    osc.start(now)
    osc.stop(now + 0.16)
    return
  }

  if (kind === 'welcome') {
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(261.63, now)
    osc.frequency.setValueAtTime(329.63, now + 0.3)
    osc.frequency.setValueAtTime(392.00, now + 0.6)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(0.1, now + 0.2)
    gain.gain.linearRampToValueAtTime(0.08, now + 0.6)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5)
    osc.start(now)
    osc.stop(now + 1.6)
    return
  }

  if (kind === 'error') {
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(150, now)
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.2)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(0.05, now + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)
    osc.start(now)
    osc.stop(now + 0.26)
    return
  }

  if (kind === 'ambient') {
    osc.type = 'sine'
    osc.frequency.setValueAtTime(55, now)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(0.02, now + 2)
    gain.gain.linearRampToValueAtTime(0.0001, now + 8)
    osc.start(now)
    osc.stop(now + 8.1)
    return
  }

  if (kind === 'loading') {
    osc.type = 'sine'
    osc.frequency.setValueAtTime(220, now)
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.35)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
    osc.start(now)
    osc.stop(now + 0.36)
    return
  }

  if (kind === 'mission_complete') {
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(392, now)
    osc.frequency.setValueAtTime(523.25, now + 0.12)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
    osc.start(now)
    osc.stop(now + 0.32)
    return
  }

  osc.type = 'square'
  osc.frequency.setValueAtTime(330, now)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.03, now + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1)
  osc.start(now)
  osc.stop(now + 0.11)
}

/**
 * Stop any currently playing voiceover
 */
export function stopVoiceover(): void {
  if (currentVoice) {
    currentVoice.pause()
    currentVoice.currentTime = 0
    currentVoice = null
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

/**
 * Play voiceover with ElevenLabs (backend) or native speech fallback.
 * Returns the estimated duration in ms so the caller can sync typewriter speed.
 */
export async function playGameVoiceover(params: {
  text: string
  role?: 'narrator' | 'character'
  avatarStyle?: string
}): Promise<number> {
  // Stop any previous voice
  stopVoiceover()

  try {
    const blob = await gameApi.generateVoiceover({
      text: params.text,
      role: params.role || 'narrator',
      avatar_style: params.avatarStyle,
    })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.volume = 0.85
    currentVoice = audio

    // Wait for metadata to get duration
    return new Promise<number>((resolve) => {
      audio.onloadedmetadata = () => {
        const durationMs = (audio.duration || 3) * 1000
        audio.play().catch(() => {})
        resolve(durationMs)
      }
      audio.onended = () => {
        URL.revokeObjectURL(url)
        currentVoice = null
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        currentVoice = null
        // Fallback duration estimate: ~130ms per word
        resolve(params.text.split(/\s+/).length * 130)
      }
      // Timeout fallback if metadata doesn't load
      setTimeout(() => resolve(params.text.split(/\s+/).length * 130), 3000)
    })
  } catch {
    // Fallback to native browser speech synthesis
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(params.text)
      const voices = window.speechSynthesis.getVoices()
      let preferredVoice = undefined

      if (params.role === 'narrator') {
        // Deep, gravelly narrator voice
        preferredVoice = voices.find(v => v.name.includes('Daniel') || v.name.includes('Alex') || (v.lang.startsWith('en-GB') && v.name.includes('Male')))
        if (!preferredVoice) preferredVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Male'))
        utterance.pitch = 0.65 // Deeper
        utterance.rate = 0.82  // Slower, more deliberate
      } else {
        if (params.avatarStyle === 'merchant') {
          preferredVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Male'))
          utterance.pitch = 0.9
          utterance.rate = 0.95
        } else if (params.avatarStyle === 'sage') {
          preferredVoice = voices.find(v => v.lang.startsWith('en-GB')) || voices.find(v => v.lang.startsWith('en') && v.name.includes('Male'))
          utterance.pitch = 0.6  // Very deep sage voice
          utterance.rate = 0.78  // Slow, wise pacing
        } else {
          preferredVoice = voices.find(v => v.lang.startsWith('en'))
          utterance.pitch = 0.8
          utterance.rate = 0.88
        }
      }

      if (preferredVoice) utterance.voice = preferredVoice
      window.speechSynthesis.speak(utterance)
    }

    // Estimate duration: ~130ms per word
    return params.text.split(/\s+/).length * 130
  }
}
