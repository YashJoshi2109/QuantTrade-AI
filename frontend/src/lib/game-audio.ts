import { gameApi } from '@/lib/game-api'

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    audioCtx = new Ctx()
  }
  return audioCtx
}

export async function playGameSfx(kind: 'loading' | 'mission_complete' | 'click'): Promise<void> {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') await ctx.resume()

  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)

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
  gain.gain.exponentialRampToValueAtTime(0.04, now + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1)
  osc.start(now)
  osc.stop(now + 0.11)
}

export async function playGameVoiceover(params: {
  text: string
  role?: 'narrator' | 'character'
  avatarStyle?: string
}): Promise<void> {
  const blob = await gameApi.generateVoiceover({
    text: params.text,
    role: params.role || 'narrator',
    avatar_style: params.avatarStyle,
  })
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.volume = 0.9
  try {
    await audio.play()
  } finally {
    audio.onended = () => URL.revokeObjectURL(url)
  }
}
