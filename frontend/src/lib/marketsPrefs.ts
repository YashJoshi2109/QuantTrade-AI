'use client'

/** Markets page view state, persisted per user and shared by desktop and mobile. */
import { CONTINENTS, DISPLAY_CURRENCIES, type Continent } from './world-exchanges'
import { oneOf, usePersistentState } from './persistentState'

const CONTINENT_IDS = CONTINENTS.map((c) => c.id) as Continent[]
const CURRENCY_CODES = DISPLAY_CURRENCIES.map((c) => c.code) as string[]

export function useMarketsContinent() {
  return usePersistentState<Continent>('markets.continent', 'global', { version: 1, validate: oneOf(CONTINENT_IDS) })
}

export function useMarketsCurrency() {
  return usePersistentState<string>('markets.currency', 'USD', { version: 1, validate: oneOf(CURRENCY_CODES) })
}

export function useMarketsView() {
  return usePersistentState<'heatmap' | 'list'>('markets.view', 'heatmap', { version: 1, validate: oneOf(['heatmap', 'list'] as const) })
}
