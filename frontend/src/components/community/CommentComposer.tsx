'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Loader2, X } from 'lucide-react'

interface CommentComposerProps {
  postId: number
  parentId?: number | null
  placeholder?: string
  autoFocus?: boolean
  onSubmit: (body: string, parentId?: number | null) => Promise<void>
  onCancel?: () => void
  isReply?: boolean
}

export default function CommentComposer({
  postId,
  parentId = null,
  placeholder = 'Share your analysis...',
  autoFocus = false,
  onSubmit,
  onCancel,
  isReply = false,
}: CommentComposerProps) {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [body])

  const handleSubmit = async () => {
    const trimmed = body.trim()
    if (!trimmed || submitting) return

    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(trimmed, parentId)
      setBody('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment')
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape' && onCancel) {
      onCancel()
    }
  }

  return (
    <motion.div
      initial={isReply ? { opacity: 0, height: 0 } : false}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="w-full"
    >
      <div className="bg-surface-base border border-line-subtle rounded-lg overflow-hidden focus-within:border-blue-500/30 transition-colors">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={isReply ? 2 : 3}
          disabled={submitting}
          className="w-full bg-transparent text-sm text-fg-primary placeholder:text-fg-muted p-3 resize-none outline-none disabled:opacity-50 min-h-[80px] sm:min-h-0"
        />

        <div className="flex items-center justify-between px-3 pb-2">
          <span className="text-[10px] text-fg-muted">
            {body.length > 0 && `${body.length} chars`}
            {body.length === 0 && (
              <span className="hidden sm:inline">Ctrl+Enter to submit</span>
            )}
          </span>

          <div className="flex items-center gap-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg-secondary transition-colors px-2 py-1.5 sm:py-1 rounded min-h-[44px] sm:min-h-0"
              >
                <X className="w-3 h-3" />
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!body.trim() || submitting}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 sm:py-1.5 rounded-md
                bg-blue-600/80 text-white hover:bg-blue-600 transition-colors
                disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0"
            >
              {submitting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Send className="w-3 h-3" />
              )}
              {isReply ? 'Reply' : 'Comment'}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="text-xs text-red-400 mt-1.5 px-1"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
