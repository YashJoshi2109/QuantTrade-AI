/**
 * QuantTrade Life — Zustand game state store
 */
import { create } from 'zustand'
import type { BootstrapResponse, GameCharacter, GameWallet, GameMission, CommunityGroup } from './game-api'

interface GameState {
  bootstrapped: boolean
  loading: boolean
  error: string | null

  isNewCharacter: boolean
  stage: string
  stageDisplay: string
  realm: string
  age: number | null

  character: GameCharacter | null
  wallet: GameWallet | null
  missions: GameMission[]
  communityGroups: CommunityGroup[]
  storyArc: { id: string; step: number; narrative: string } | null
  unlockedAssets: string[]

  // Actions
  setBootstrap: (data: BootstrapResponse) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  updateMission: (id: number, updates: Partial<GameMission>) => void
  awardXP: (xp: number) => void
  awardGold: (gold: number) => void
  reset: () => void
}

export const useGameStore = create<GameState>((set) => ({
  bootstrapped: false,
  loading: false,
  error: null,
  isNewCharacter: false,
  stage: '',
  stageDisplay: '',
  realm: '',
  age: null,
  character: null,
  wallet: null,
  missions: [],
  communityGroups: [],
  storyArc: null,
  unlockedAssets: [],

  setBootstrap: (data) =>
    set({
      bootstrapped: true,
      loading: false,
      error: null,
      isNewCharacter: data.is_new_character,
      stage: data.stage,
      stageDisplay: data.stage_display,
      realm: data.realm,
      age: data.age,
      character: data.character,
      wallet: data.wallet,
      missions: data.missions,
      communityGroups: data.community_groups,
      storyArc: data.story_arc,
      unlockedAssets: data.unlocked_assets,
    }),

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),

  updateMission: (id, updates) =>
    set((state) => ({
      missions: state.missions.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),

  awardXP: (xp) =>
    set((state) => {
      if (!state.character) return state
      const newXP = state.character.xp + xp
      return {
        character: {
          ...state.character,
          xp: newXP >= state.character.xp_to_next_level
            ? newXP - state.character.xp_to_next_level
            : newXP,
          level: newXP >= state.character.xp_to_next_level
            ? state.character.level + 1
            : state.character.level,
        },
      }
    }),

  awardGold: (gold) =>
    set((state) => {
      if (!state.wallet) return state
      return { wallet: { ...state.wallet, gold_coins: state.wallet.gold_coins + gold } }
    }),

  reset: () =>
    set({
      bootstrapped: false,
      loading: false,
      error: null,
      character: null,
      wallet: null,
      missions: [],
      communityGroups: [],
      storyArc: null,
    }),
}))
