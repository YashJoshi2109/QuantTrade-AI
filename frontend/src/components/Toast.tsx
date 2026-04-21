'use client'

import { useState, useCallback, createContext, useContext, useRef, useEffect, ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  message: string
  type: ToastType
  duration: number
  createdAt: number
}

interface ToastContextType {
  toasts: Toast[]
  addToast: (message: string, type?: ToastType, duration?: number) => void
  removeToast: (id: string) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
  warning: (message: string, duration?: number) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

// ── Config ────────────────────────────────────────────────────────

const TOAST_CONFIG: Record<
  ToastType,
  { icon: typeof CheckCircle2; iconColor: string; bg: string; border: string; progress: string }
> = {
  success: {
    icon: CheckCircle2,
    iconColor: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    progress: 'bg-emerald-400',
  },
  error: {
    icon: AlertCircle,
    iconColor: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    progress: 'bg-red-400',
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    progress: 'bg-blue-400',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    progress: 'bg-amber-400',
  },
}

// ── Progress Bar ──────────────────────────────────────────────────

function ProgressBar({ duration, color }: { duration: number; color: string }) {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/5 overflow-hidden rounded-b-xl">
      <motion.div
        className={`h-full ${color}`}
        initial={{ width: '100%' }}
        animate={{ width: '0%' }}
        transition={{ duration: duration / 1000, ease: 'linear' }}
      />
    </div>
  )
}

// ── Single Toast ──────────────────────────────────────────────────

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const config = TOAST_CONFIG[toast.type]
  const Icon = config.icon

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      role="alert"
      aria-live="polite"
      className={`relative flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-lg shadow-2xl shadow-black/40 min-w-[300px] max-w-[420px] ${config.bg} ${config.border}`}
    >
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${config.iconColor}`} />
      <p className="text-sm text-slate-200 flex-1 leading-snug pr-6">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="absolute top-2.5 right-2.5 p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <ProgressBar duration={toast.duration} color={config.progress} />
    </motion.div>
  )
}

// ── Provider ──────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const addToast = useCallback((message: string, type: ToastType = 'info', duration: number = 4000) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const toast: Toast = { id, message, type, duration, createdAt: Date.now() }

    setToasts(prev => [...prev.slice(-4), toast]) // max 5 visible

    if (duration > 0) {
      const timer = setTimeout(() => removeToast(id), duration)
      timersRef.current.set(id, timer)
    }

    return id
  }, [removeToast])

  const success = useCallback((message: string, duration?: number) =>
    addToast(message, 'success', duration), [addToast])
  const error = useCallback((message: string, duration?: number) =>
    addToast(message, 'error', duration ?? 6000), [addToast])
  const info = useCallback((message: string, duration?: number) =>
    addToast(message, 'info', duration), [addToast])
  const warning = useCallback((message: string, duration?: number) =>
    addToast(message, 'warning', duration ?? 5000), [addToast])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer))
    }
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, info, warning }}>
      {children}
      {/* Toast container - fixed top right, stacks vertically */}
      <div
        className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
        role="region"
        aria-label="Notifications"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map(toast => (
            <div key={toast.id} className="pointer-events-auto">
              <ToastItem toast={toast} onRemove={removeToast} />
            </div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
