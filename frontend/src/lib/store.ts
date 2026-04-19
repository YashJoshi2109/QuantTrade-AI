/**
 * Zustand store for global state management
 */
import { create } from 'zustand'

interface AppState {
  selectedSymbol: string | null
  setSelectedSymbol: (symbol: string | null) => void

  activeTab: string
  setActiveTab: (tab: string) => void

  user: {
    id: string | null
    email: string | null
    token: string | null
  } | null
  setUser: (user: { id: string; email: string; token: string } | null) => void

  // Cross-chart synchronization
  syncedTimestamp: number | null
  setSyncedTimestamp: (ts: number | null) => void
  hoveredChart: string | null
  setHoveredChart: (id: string | null) => void

  // Notification badge count
  unreadNotifications: number
  setUnreadNotifications: (count: number) => void

  // Community state
  activeCommunity: string | null
  setActiveCommunity: (slug: string | null) => void
  feedSort: 'hot' | 'new' | 'top' | 'following'
  setFeedSort: (sort: 'hot' | 'new' | 'top' | 'following') => void
}

export const useAppStore = create<AppState>((set) => ({
  selectedSymbol: null,
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),

  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),

  user: null,
  setUser: (user) => set({ user }),

  // Cross-chart synchronization
  syncedTimestamp: null,
  setSyncedTimestamp: (ts) => set({ syncedTimestamp: ts }),
  hoveredChart: null,
  setHoveredChart: (id) => set({ hoveredChart: id }),

  // Notification badge count
  unreadNotifications: 0,
  setUnreadNotifications: (count) => set({ unreadNotifications: count }),

  // Community state
  activeCommunity: null,
  setActiveCommunity: (slug) => set({ activeCommunity: slug }),
  feedSort: 'hot',
  setFeedSort: (sort) => set({ feedSort: sort }),
}))
