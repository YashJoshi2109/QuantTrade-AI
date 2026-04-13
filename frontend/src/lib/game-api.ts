/**
 * QuantTrade Life — Game API client
 * All calls attach the JWT from localStorage.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('auth_token')
}

function authHeaders(): HeadersInit {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

async function gameGet<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/game${path}`, {
      method: 'GET',
      headers: authHeaders(),
    })
  } catch {
    throw new Error(
      `Cannot reach game API at ${API_URL}. Is the backend running and NEXT_PUBLIC_API_URL correct?`
    )
  }
  if (res.status === 401) throw new Error('UNAUTHENTICATED')
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }))
    const detail = err.detail
    const msg =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? JSON.stringify(detail)
          : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return res.json()
}

async function gamePost<T>(path: string, body?: object): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/game${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error(
      `Cannot reach game API at ${API_URL}. Is the backend running and NEXT_PUBLIC_API_URL correct?`
    )
  }
  if (res.status === 401) throw new Error('UNAUTHENTICATED')
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }))
    const detail = err.detail
    const msg =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? JSON.stringify(detail)
          : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return res.json()
}

async function gamePostBlob(path: string, body?: object): Promise<Blob> {
  const res = await fetch(`${API_URL}/api/v1/game${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) throw new Error('UNAUTHENTICATED')
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.blob()
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type LifeStage = 'student' | 'college' | 'early_career' | 'family' | 'mastery'

export interface GameCharacter {
  id: number
  name: string
  avatar_style: 'knight' | 'scholar' | 'merchant' | 'noble' | 'sage'
  life_stage: LifeStage
  level: number
  xp: number
  xp_to_next_level: number
  streak_days: number
  financial_confidence: number
  discipline_score: number
  risk_appetite: number
  savings_habit: number
  emotional_resilience: number
  diversification_score: number
  current_story_arc: string
  story_arc_step: number
  behavioral_profile: Record<string, number>
}

export interface GameWallet {
  cash_balance: number
  salary_monthly: number
  emergency_fund: number
  total_invested: number
  total_debt: number
  net_worth: number
  gold_coins: number
  silver_coins: number
  monthly_expenses: number
  savings_rate: number
  net_worth_history: Array<{ date: string; net_worth: number }>
}

export interface GameMission {
  id: number
  title: string
  description: string
  mission_type: 'daily' | 'weekly' | 'story' | 'bonus'
  category: string
  target_value: number
  current_value: number
  xp_reward: number
  gold_reward: number
  status: 'pending' | 'active' | 'completed' | 'failed'
  progress_pct: number
}

export interface CommunityGroup {
  id: number
  name: string
  slug: string
  description: string
  icon: string
  color: string
  member_count: number
  is_global: boolean
  my_reputation?: number
}

export interface StoryArc {
  id: string
  step: number
  narrative: string
}

export interface BootstrapResponse {
  is_new_character: boolean
  stage: LifeStage
  stage_display: string
  realm: string
  age: number | null
  character: GameCharacter
  wallet: GameWallet
  missions: GameMission[]
  community_groups: CommunityGroup[]
  story_arc: StoryArc
  unlocked_assets: string[]
}

export interface StageConfig {
  stage: LifeStage
  display: string
  realm: string
  description: string
  unlocked_assets: string[]
  story_arc: string
  story_arc_narrative: string
  age: number | null
}

// ── API functions ─────────────────────────────────────────────────────────────

export const gameApi = {
  bootstrap: () => gameGet<BootstrapResponse>('/bootstrap'),

  getCharacter: () => gameGet<GameCharacter>('/character'),

  updateCharacter: (data: { name?: string; avatar_style?: string }) =>
    gamePost<{ success: boolean; name: string; avatar_style: string }>('/character/update', data),

  getWallet: () => gameGet<GameWallet>('/wallet'),

  getMissions: () => gameGet<GameMission[]>('/missions'),

  completeMission: (mission_id: number) =>
    gamePost<{
      success: boolean
      xp_awarded: number
      gold_awarded: number
      leveled_up: boolean
      new_level: number
      new_xp: number
    }>('/mission/complete', { mission_id }),

  getCommunity: () => gameGet<CommunityGroup[]>('/community'),

  getStageConfig: () => gameGet<StageConfig>('/stage-config'),

  generateVoiceover: (data: { text: string; role?: 'narrator' | 'character'; avatar_style?: string }) =>
    gamePostBlob('/audio/voiceover', data),
}
