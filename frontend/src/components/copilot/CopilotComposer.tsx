'use client'

import { forwardRef, useId } from 'react'
import TextareaAutosize from 'react-textarea-autosize'
import { ArrowUp, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CopilotComposerProps {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  /** Sending is blocked (allowance used up); typing still works so nothing is lost. */
  blocked?: boolean
  blockedReason?: string
  placeholder?: string
  focusSymbol?: string | null
  compact?: boolean
}

/**
 * The primary action on the page: an opaque, high-contrast composer.
 * Enter sends, Shift+Enter adds a line, Esc stops a running answer and
 * "/" anywhere on the page focuses it (wired in the page).
 */
const CopilotComposer = forwardRef<HTMLTextAreaElement, CopilotComposerProps>(function CopilotComposer(
  { value, onChange, onSend, onStop, streaming, blocked, blockedReason, placeholder, focusSymbol, compact },
  ref,
) {
  const hintId = useId()
  const canSend = value.trim().length > 0 && !streaming && !blocked

  return (
    <div>
      <div
        className={cn(
          'cp-composer flex items-end gap-2 rounded-2xl border border-[var(--cp-line-strong)] bg-[var(--cp-panel)] p-2 pl-4',
          'shadow-[var(--cp-composer-shadow)] transition-[border-color,box-shadow]',
        )}
      >
        <label className="sr-only" htmlFor={`${hintId}-input`}>
          Ask Copilot a question
        </label>
        <TextareaAutosize
          ref={ref}
          id={`${hintId}-input`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (canSend) onSend()
            } else if (e.key === 'Escape' && streaming) {
              e.preventDefault()
              onStop()
            }
          }}
          minRows={1}
          maxRows={8}
          aria-describedby={`${hintId}-hint`}
          placeholder={placeholder ?? (focusSymbol ? `Ask about ${focusSymbol}, or any other US stock` : 'Ask about any US stock')}
          className={cn(
            'min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[16px] leading-6 text-[var(--cp-ink)]',
            'placeholder:text-[var(--cp-ink-3)] focus:outline-none',
          )}
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-[var(--cp-line-strong)] bg-[var(--cp-sunken)] px-3.5 text-sm font-semibold text-[var(--cp-ink)] hover:bg-[var(--cp-line)]"
          >
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            aria-label="Send question"
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors',
              'bg-[var(--cp-accent)] text-[var(--cp-on-accent)] hover:bg-[var(--cp-accent-hover)]',
              'disabled:cursor-not-allowed disabled:bg-[var(--cp-sunken)] disabled:text-[var(--cp-ink-3)]',
            )}
          >
            <ArrowUp className="h-5 w-5" strokeWidth={2.25} aria-hidden />
          </button>
        )}
      </div>
      <p id={`${hintId}-hint`} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12px] text-[var(--cp-ink-3)]">
        {blocked && blockedReason ? (
          <span className="text-[var(--cp-caution-ink)]">{blockedReason}</span>
        ) : streaming ? (
          <span>
            <kbd className="cp-kbd">Esc</kbd> stops the answer
          </span>
        ) : (
          <>
            <span><kbd className="cp-kbd">Enter</kbd> to send</span>
            {!compact && <span><kbd className="cp-kbd">Shift</kbd> + <kbd className="cp-kbd">Enter</kbd> for a new line</span>}
            {!compact && <span><kbd className="cp-kbd">/</kbd> to focus</span>}
          </>
        )}
        <span className="ml-auto">Not financial advice</span>
      </p>
    </div>
  )
})

export default CopilotComposer
