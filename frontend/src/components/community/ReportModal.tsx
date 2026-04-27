'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, AlertTriangle, Loader2 } from 'lucide-react'
import { reportContent } from '@/lib/api'

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam', description: 'Irrelevant or unsolicited content' },
  { value: 'misinformation', label: 'Misinformation', description: 'False or misleading financial information' },
  { value: 'manipulation', label: 'Market Manipulation', description: 'Coordinated pump-and-dump or deceptive schemes' },
  { value: 'harassment', label: 'Harassment', description: 'Abusive, threatening, or discriminatory content' },
  { value: 'other', label: 'Other', description: 'Something else not listed above' },
]

interface ReportModalProps {
  isOpen: boolean
  onClose: () => void
  targetId: number
  targetType: 'post' | 'comment'
}

export default function ReportModal({ isOpen, onClose, targetId, targetType }: ReportModalProps) {
  const [reason, setReason] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async () => {
    if (!reason) return
    setSubmitting(true)
    try {
      const ok = await reportContent(targetId, targetType, reason, description.trim() || undefined)
      if (ok) {
        setSubmitted(true)
        setTimeout(() => {
          onClose()
          setSubmitted(false)
          setReason('')
          setDescription('')
        }, 1500)
      }
    } catch {
      // Could show error toast
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    onClose()
    setReason('')
    setDescription('')
    setSubmitted(false)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
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
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-semibold text-fg-primary">
                  Report {targetType === 'post' ? 'Post' : 'Comment'}
                </h2>
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-fg-muted hover:text-fg-secondary hover:bg-surface-hover transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {submitted ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-8 text-center"
              >
                <div className="w-12 h-12 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-fg-primary font-medium">Report submitted</p>
                <p className="text-sm text-fg-muted mt-1">Our moderation team will review this shortly.</p>
              </motion.div>
            ) : (
              <>
                {/* Body */}
                <div className="p-5 space-y-4">
                  <p className="text-sm text-fg-secondary">
                    Why are you reporting this {targetType}? Select the reason that best applies.
                  </p>

                  {/* Radio options */}
                  <div className="space-y-2">
                    {REPORT_REASONS.map((r) => (
                      <label
                        key={r.value}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors min-h-[44px] ${
                          reason === r.value
                            ? 'border-blue-500/40 bg-blue-500/[0.06]'
                            : 'border-line-subtle hover:border-line-default hover:bg-surface-hover'
                        }`}
                      >
                        <input
                          type="radio"
                          name="report-reason"
                          value={r.value}
                          checked={reason === r.value}
                          onChange={() => setReason(r.value)}
                          className="mt-0.5 accent-blue-500"
                        />
                        <div>
                          <span className="text-sm font-medium text-fg-primary">{r.label}</span>
                          <p className="text-xs text-fg-muted mt-0.5">{r.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>

                  {/* Optional description */}
                  <textarea
                    placeholder="Additional details (optional)"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full bg-surface-raised border border-line-subtle rounded-xl px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted resize-none focus:outline-none focus:border-blue-500/40"
                  />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-line-subtle">
                  <button
                    onClick={handleClose}
                    className="px-4 py-2.5 text-sm text-fg-muted hover:text-fg-primary transition-colors min-h-[44px]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!reason || submitting}
                    className="flex items-center gap-2 px-5 py-2.5 bg-red-500/80 text-white rounded-xl text-sm font-medium hover:bg-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
                  >
                    {submitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <AlertTriangle className="w-4 h-4" />
                    )}
                    Submit Report
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
