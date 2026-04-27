'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Keyboard, X } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────

interface ShortcutAction {
  key: string
  label: string
  category: string
}

const SHORTCUTS: ShortcutAction[] = [
  { key: 'n', label: 'Create new post', category: 'Navigation' },
  { key: 'j', label: 'Next post', category: 'Navigation' },
  { key: 'k', label: 'Previous post', category: 'Navigation' },
  { key: 'Enter', label: 'Open focused post', category: 'Navigation' },
  { key: 'u', label: 'Upvote focused post', category: 'Actions' },
  { key: 'd', label: 'Downvote focused post', category: 'Actions' },
  { key: 'Esc', label: 'Close modal', category: 'General' },
  { key: '?', label: 'Show shortcuts', category: 'General' },
]

// ── Hook ──────────────────────────────────────────────────────────

interface UseKeyboardShortcutsOptions {
  onCreatePost: () => void
  onNavigate: (direction: 'next' | 'prev') => void
  onOpenPost: () => void
  onUpvote: () => void
  onDownvote: () => void
  onCloseModal: () => void
  isModalOpen: boolean
}

export function useKeyboardShortcuts({
  onCreatePost,
  onNavigate,
  onOpenPost,
  onUpvote,
  onDownvote,
  onCloseModal,
  isModalOpen,
}: UseKeyboardShortcutsOptions) {
  const [showHelp, setShowHelp] = useState(false)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't trigger when typing in input/textarea
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        // Allow Escape even in inputs
        if (e.key === 'Escape') {
          onCloseModal()
          setShowHelp(false)
        }
        return
      }

      // Detect mobile — skip shortcuts
      if ('ontouchstart' in window && window.innerWidth < 768) return

      switch (e.key) {
        case 'n':
          if (!isModalOpen) {
            e.preventDefault()
            onCreatePost()
          }
          break
        case 'j':
          if (!isModalOpen) {
            e.preventDefault()
            onNavigate('next')
          }
          break
        case 'k':
          if (!isModalOpen) {
            e.preventDefault()
            onNavigate('prev')
          }
          break
        case 'Enter':
          if (!isModalOpen) {
            e.preventDefault()
            onOpenPost()
          }
          break
        case 'u':
          if (!isModalOpen) {
            e.preventDefault()
            onUpvote()
          }
          break
        case 'd':
          if (!isModalOpen) {
            e.preventDefault()
            onDownvote()
          }
          break
        case 'Escape':
          e.preventDefault()
          onCloseModal()
          setShowHelp(false)
          break
        case '?':
          if (!isModalOpen) {
            e.preventDefault()
            setShowHelp((prev) => !prev)
          }
          break
      }
    },
    [isModalOpen, onCreatePost, onNavigate, onOpenPost, onUpvote, onDownvote, onCloseModal]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return { showHelp, setShowHelp }
}

// ── Help Modal ────────────────────────────────────────────────────

export function ShortcutHelpModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const grouped = SHORTCUTS.reduce(
    (acc, s) => {
      if (!acc[s.category]) acc[s.category] = []
      acc[s.category].push(s)
      return acc
    },
    {} as Record<string, ShortcutAction[]>
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md bg-surface-overlay border border-line-subtle rounded-2xl shadow-theme-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-line-subtle">
              <div className="flex items-center gap-2.5">
                <Keyboard className="w-5 h-5 text-blue-400" />
                <h2 className="text-lg font-semibold text-fg-primary">Keyboard Shortcuts</h2>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-fg-muted hover:text-fg-secondary hover:bg-surface-hover transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-5">
              {Object.entries(grouped).map(([category, shortcuts]) => (
                <div key={category}>
                  <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-2.5">
                    {category}
                  </h3>
                  <div className="space-y-1.5">
                    {shortcuts.map((s) => (
                      <div
                        key={s.key}
                        className="flex items-center justify-between py-1.5"
                      >
                        <span className="text-sm text-fg-secondary">{s.label}</span>
                        <kbd className="px-2 py-1 text-xs font-mono text-fg-secondary bg-surface-raised border border-line-subtle rounded-md min-w-[28px] text-center">
                          {s.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-line-subtle bg-surface-hover">
              <p className="text-xs text-fg-muted text-center">
                Press <kbd className="px-1 py-0.5 text-[10px] bg-surface-raised border border-line-subtle rounded">?</kbd> to toggle this menu
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
