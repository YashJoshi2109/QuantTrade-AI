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
}

export const useAppStore = create<AppState>((set) => ({
  selectedSymbol: null,
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  
  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),
  
  user: null,
  setUser: (user) => set({ user }),
}))
