'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { AnimatePresence, motion } from 'framer-motion'
import { Mic, Wand2, Paperclip, ArrowUp, X, StopCircle } from 'lucide-react'
import TextareaAutosize from 'react-textarea-autosize'

import type { CopilotUsage } from '@/lib/api'
import { cn } from '@/lib/utils'

const promptShellVariants = cva('relative w-full overflow-hidden rounded-2xl p-px', {
  variants: {
    variant: {
      default:
        'bg-gradient-to-r from-cyan-500/30 via-line-default to-line-default',
      magic:
        'bg-gradient-to-r from-cyan-500/25 via-line-default to-indigo-500/20',
    },
  },
  defaultVariants: {
    variant: 'magic',
  },
})

export interface CopilotPromptInputProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'ref' | 'onSubmit' | 'style'>,
    VariantProps<typeof promptShellVariants> {
  streaming?: boolean
  onSend: () => void
  onStop?: () => void
  usage?: CopilotUsage | null
  onUpgrade?: () => void
}

const CopilotPromptInput = React.forwardRef<HTMLTextAreaElement, CopilotPromptInputProps>(
  (
    {
      className,
      variant,
      streaming,
      onSend,
      onStop,
      usage,
      onUpgrade,
      value,
      disabled,
      ...props
    },
    ref
  ) => {
    const [showBanner, setShowBanner] = React.useState(true)

    const actionButtons = React.useMemo(
      () => [
        { icon: Mic, label: 'Voice input (coming soon)' },
        { icon: Wand2, label: 'Copilot tools' },
        { icon: Paperclip, label: 'Attach (coming soon)' },
      ],
      []
    )

    const strValue = typeof value === 'string' ? value : ''
    const canSend = strValue.trim().length > 0 && !streaming && !disabled
    const usageForBanner =
      usage && !usage.is_pro && usage.free_limit > 0 ? usage : null

    return (
      <div className={cn(promptShellVariants({ variant }), className)}>
        <div
          className={cn(
            'relative flex h-full w-full flex-col rounded-[15px]',
            'border border-line-subtle bg-surface-raised',
            'shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
          )}
        >
          <AnimatePresence initial={false}>
            {usageForBanner && showBanner && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.28, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-3 py-2 text-xs sm:px-4 sm:text-sm">
                  <span className="text-left text-fg-secondary">
                    <span className="font-semibold text-fg-primary">{usageForBanner.free_remaining}</span>
                    <span className="text-fg-muted"> / {usageForBanner.free_limit} </span>
                    free requests today
                  </span>
                  <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                    {onUpgrade ? (
                      <button
                        type="button"
                        onClick={onUpgrade}
                        className="font-medium text-cyan-400 transition-colors hover:text-cyan-300"
                      >
                        Upgrade
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setShowBanner(false)}
                      aria-label="Dismiss usage notice"
                      className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-primary"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-col p-2 sm:p-3">
            <TextareaAutosize
              ref={ref}
              value={value}
              disabled={disabled}
              minRows={1}
              maxRows={10}
              className={cn(
                'w-full resize-none bg-transparent text-sm text-fg-primary sm:text-base',
                'placeholder:text-fg-muted',
                'focus:outline-none focus:ring-0',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
              {...props}
            />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 sm:mt-4">
              <div className="flex items-center gap-1.5 text-fg-muted sm:gap-2">
                {actionButtons.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.label}
                      type="button"
                      aria-label={item.label}
                      title={item.label}
                      disabled={Boolean(disabled) || Boolean(streaming)}
                      className="rounded-lg p-2 transition-colors hover:bg-surface-hover hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Icon className="h-5 w-5" aria-hidden />
                    </button>
                  )
                })}
              </div>

              {streaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="Stop generation"
                  className={cn(
                    'flex h-10 min-w-[2.5rem] items-center justify-center gap-2 rounded-full px-3',
                    'border border-red-500/45 bg-red-500/20 text-red-100 transition-colors',
                    'hover:bg-red-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50'
                  )}
                >
                  <StopCircle className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="hidden text-xs font-semibold sm:inline">Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSend}
                  aria-label="Send message"
                  disabled={!canSend}
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-all',
                    'bg-gradient-to-br from-cyan-500 to-blue-600 shadow-[0_0_12px_rgba(6,182,212,0.2)]',
                    'hover:brightness-110',
                    'disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-fg-muted disabled:shadow-none disabled:brightness-100',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised'
                  )}
                >
                  <ArrowUp className="h-5 w-5" aria-hidden />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }
)
CopilotPromptInput.displayName = 'CopilotPromptInput'

export { CopilotPromptInput }
