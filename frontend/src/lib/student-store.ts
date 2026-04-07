/**
 * QuantTrade Life — Student Stage Zustand Store
 * Manages all financial state for the Ashmarket student arc
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface LedgerEntry {
  id: string
  label: string
  amount: number
  category: 'earn' | 'spend' | 'save' | 'emergency' | 'debt' | 'invest'
  chapterId: string
  day: number
  timestamp: number
}

export interface OwnedAsset {
  id: string
  name: string
  emoji: string
  unitsBought: number
  costPerUnit: number
  totalCost: number
  acquiredDay: number
}

export interface StudentState {
  // Progress
  completedChapters: string[]
  currentChapterId: string | null
  dayNumber: number
  xp: number
  level: number

  // Finances
  gold: number           // liquid spending gold
  savings: number        // goal savings (roof fund → next goal)
  emergency: number      // winter reserve
  debt: number           // total debt owed
  vaultBalance: number   // deposited in Guild Vault
  vaultInterestRate: number // % per month

  // Goal tracking
  roofRepaired: boolean
  roofTarget: number
  currentGoalLabel: string
  currentGoalTarget: number
  currentGoalSaved: number

  // Assets
  ownedAssets: OwnedAsset[]

  // Ledger
  ledger: LedgerEntry[]

  // Actions
  completeChapter: (chapterId: string) => void
  setCurrentChapter: (chapterId: string | null) => void
  applyChoiceResult: (params: {
    chapterId: string
    goldDelta: number
    savingsDelta: number
    emergencyDelta: number
    debtDelta: number
    xpReward: number
    label: string
  }) => void
  addLedgerEntry: (entry: Omit<LedgerEntry, 'id' | 'timestamp'>) => void
  buyAsset: (asset: Omit<OwnedAsset, 'id' | 'acquiredDay'>) => void
  depositToVault: (amount: number) => void
  withdrawFromVault: (amount: number) => void
  setRoofRepaired: (repaired: boolean) => void
  advanceDay: () => void
  reset: () => void
}

const INITIAL_STATE: Omit<
  StudentState,
  | 'completeChapter'
  | 'setCurrentChapter'
  | 'applyChoiceResult'
  | 'addLedgerEntry'
  | 'buyAsset'
  | 'depositToVault'
  | 'withdrawFromVault'
  | 'setRoofRepaired'
  | 'advanceDay'
  | 'reset'
> = {
  completedChapters: [],
  currentChapterId: null,
  dayNumber: 1,
  xp: 0,
  level: 1,
  gold: 20,
  savings: 0,
  emergency: 0,
  debt: 0,
  vaultBalance: 0,
  vaultInterestRate: 0.04,
  roofRepaired: false,
  roofTarget: 60,
  currentGoalLabel: 'Roof Repair Fund',
  currentGoalTarget: 60,
  currentGoalSaved: 0,
  ownedAssets: [],
  ledger: [],
}

function xpToLevel(xp: number): number {
  if (xp < 100) return 1
  if (xp < 250) return 2
  if (xp < 500) return 3
  if (xp < 800) return 4
  if (xp < 1200) return 5
  return 6
}

let entryCounter = 0

export const useStudentStore = create<StudentState>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      completeChapter: (chapterId) =>
        set((s) => ({
          completedChapters: s.completedChapters.includes(chapterId)
            ? s.completedChapters
            : [...s.completedChapters, chapterId],
          currentChapterId: null,
        })),

      setCurrentChapter: (chapterId) => set({ currentChapterId: chapterId }),

      applyChoiceResult: ({ chapterId, goldDelta, savingsDelta, emergencyDelta, debtDelta, xpReward, label }) => {
        const s = get()
        const newGold = Math.max(0, s.gold + goldDelta)
        const newSavings = Math.max(0, s.savings + savingsDelta)
        const newEmergency = Math.max(0, s.emergency + emergencyDelta)
        const newDebt = Math.max(0, s.debt + debtDelta)
        const newXp = s.xp + xpReward
        const newLevel = xpToLevel(newXp)

        const newGoalSaved = savingsDelta > 0
          ? Math.min(s.currentGoalTarget, s.currentGoalSaved + savingsDelta)
          : s.currentGoalSaved

        // Add ledger entries for significant changes
        const entries: LedgerEntry[] = []
        if (goldDelta !== 0) {
          entries.push({
            id: `entry_${++entryCounter}`,
            label,
            amount: goldDelta,
            category: goldDelta > 0 ? 'earn' : 'spend',
            chapterId,
            day: s.dayNumber,
            timestamp: Date.now(),
          })
        }
        if (savingsDelta !== 0) {
          entries.push({
            id: `entry_${++entryCounter}`,
            label: `${label} → savings`,
            amount: savingsDelta,
            category: 'save',
            chapterId,
            day: s.dayNumber,
            timestamp: Date.now(),
          })
        }

        set({
          gold: newGold,
          savings: newSavings,
          emergency: newEmergency,
          debt: newDebt,
          xp: newXp,
          level: newLevel,
          currentGoalSaved: newGoalSaved,
          ledger: [...s.ledger, ...entries],
        })
      },

      addLedgerEntry: (entry) =>
        set((s) => ({
          ledger: [
            ...s.ledger,
            {
              ...entry,
              id: `entry_${++entryCounter}`,
              timestamp: Date.now(),
            },
          ],
        })),

      buyAsset: (asset) =>
        set((s) => {
          const cost = asset.costPerUnit * asset.unitsBought
          return {
            gold: Math.max(0, s.gold - cost),
            ownedAssets: [
              ...s.ownedAssets,
              { ...asset, id: `asset_${Date.now()}`, acquiredDay: s.dayNumber },
            ],
          }
        }),

      depositToVault: (amount) =>
        set((s) => ({
          gold: Math.max(0, s.gold - amount),
          vaultBalance: s.vaultBalance + amount,
        })),

      withdrawFromVault: (amount) =>
        set((s) => ({
          vaultBalance: Math.max(0, s.vaultBalance - amount),
          gold: s.gold + Math.min(amount, s.vaultBalance),
        })),

      setRoofRepaired: (repaired) => set({ roofRepaired: repaired }),

      advanceDay: () =>
        set((s) => {
          // Apply monthly vault interest (simplified to per-day micro-interest)
          const dailyInterest = s.vaultBalance * (s.vaultInterestRate / 30)
          return {
            dayNumber: s.dayNumber + 1,
            vaultBalance: s.vaultBalance + dailyInterest,
          }
        }),

      reset: () => set(INITIAL_STATE),
    }),
    {
      name: 'student-game-state',
      partialize: (state) => ({
        completedChapters: state.completedChapters,
        dayNumber: state.dayNumber,
        xp: state.xp,
        level: state.level,
        gold: state.gold,
        savings: state.savings,
        emergency: state.emergency,
        debt: state.debt,
        vaultBalance: state.vaultBalance,
        roofRepaired: state.roofRepaired,
        currentGoalLabel: state.currentGoalLabel,
        currentGoalTarget: state.currentGoalTarget,
        currentGoalSaved: state.currentGoalSaved,
        ownedAssets: state.ownedAssets,
        ledger: state.ledger.slice(-50), // keep last 50 entries
      }),
    }
  )
)
