'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import AppLayout from '@/components/AppLayout'
import MobileLayout from '@/components/layout/MobileLayout'
import {
  Send,
  Sparkles,
  StopCircle,
  Copy,
  Check,
  ChevronDown,
  Bot,
  User,
  Zap,
  TrendingUp,
  BarChart3,
  Shield,
  RefreshCw,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  streamCopilotMessage,
  COPILOT_MODELS,
  QUICK_PROMPTS,
  type CopilotMessage,
  type CopilotModelId,
} from '@/lib/copilot-api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  error?: boolean
  timestamp: Date
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="p-1.5 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
          isUser
            ? 'bg-[#007AFF] text-white'
            : 'bg-[#101928] border border-[rgba(0,122,255,0.2)] text-[#007AFF]'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Bubble */}
      <div className={`flex-1 max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-[#007AFF] text-white rounded-tr-sm'
              : msg.error
              ? 'bg-red-500/10 border border-red-500/30 text-red-300 rounded-tl-sm'
              : 'bg-[#101928] border border-[rgba(0,122,255,0.12)] text-slate-100 rounded-tl-sm'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0 text-slate-200">{children}</p>,
                  strong: ({ children }) => (
                    <strong className="font-bold text-white">{children}</strong>
                  ),
                  em: ({ children }) => <em className="text-slate-400 italic text-xs">{children}</em>,
                  code: ({ children, className }) => {
                    const isBlock = className?.includes('language-')
                    return isBlock ? (
                      <code className="block bg-[#0D1117] border border-slate-700/50 rounded-lg p-3 text-xs font-mono text-emerald-300 my-2 overflow-x-auto whitespace-pre">
                        {children}
                      </code>
                    ) : (
                      <code className="bg-[#0D1117] text-emerald-300 px-1.5 py-0.5 rounded text-xs font-mono">
                        {children}
                      </code>
                    )
                  },
                  ul: ({ children }) => <ul className="list-disc pl-4 space-y-1 my-2">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1 my-2">{children}</ol>,
                  li: ({ children }) => <li className="text-slate-300">{children}</li>,
                  h1: ({ children }) => <h1 className="text-white font-bold text-base mt-3 mb-1">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-white font-bold text-sm mt-3 mb-1">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-slate-100 font-semibold text-sm mt-2 mb-1">{children}</h3>,
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-2">
                      <table className="w-full text-xs border-collapse border border-slate-700/50 rounded-lg overflow-hidden">
                        {children}
                      </table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="border border-slate-700/50 bg-[#0D1117] px-3 py-1.5 text-left text-slate-300 font-semibold">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-slate-700/30 px-3 py-1.5 text-slate-400">
                      {children}
                    </td>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-[#007AFF]/40 pl-3 text-slate-400 italic my-2">
                      {children}
                    </blockquote>
                  ),
                  hr: () => <hr className="border-slate-700/50 my-3" />,
                }}
              >
                {msg.content}
              </ReactMarkdown>
              {msg.streaming && (
                <span className="inline-block w-1.5 h-4 bg-[#007AFF] rounded-sm animate-pulse ml-0.5 -mb-0.5" />
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {!isUser && !msg.streaming && msg.content && (
          <div className="flex items-center gap-1 mt-1 px-1">
            <CopyButton text={msg.content} />
            <span className="text-[10px] text-slate-600 font-mono">
              {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ─── Welcome screen ───────────────────────────────────────────────────────────

function WelcomeScreen({ onPrompt }: { onPrompt: (p: string) => void }) {
  const icons = [Zap, TrendingUp, BarChart3, Shield, Sparkles, RefreshCw]

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-10 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[#007AFF]/15 border border-[#007AFF]/30 flex items-center justify-center mb-4">
        <Sparkles className="w-7 h-7 text-[#007AFF]" />
      </div>
      <h2 className="text-xl font-bold text-white font-display mb-2">QuantTrade AI Copilot</h2>
      <p className="text-sm text-slate-400 max-w-sm mb-8">
        Institutional-quality financial analysis. Ask about stocks, sectors, macro, options, risk — anything markets.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
        {QUICK_PROMPTS.map((qp, i) => {
          const Icon = icons[i % icons.length]
          return (
            <button
              key={qp.label}
              onClick={() => onPrompt(qp.prompt)}
              className="flex items-start gap-3 p-3.5 rounded-xl bg-[#101928] border border-slate-700/50 hover:border-[#007AFF]/40 hover:bg-[#101928]/80 transition-all text-left group"
            >
              <div className="w-8 h-8 rounded-lg bg-[#007AFF]/10 flex items-center justify-center shrink-0 group-hover:bg-[#007AFF]/20 transition-colors">
                <Icon className="w-4 h-4 text-[#007AFF]" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white group-hover:text-[#007AFF] transition-colors">
                  {qp.label}
                </div>
                <div className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{qp.prompt}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Model Selector ───────────────────────────────────────────────────────────

function ModelSelector({
  value,
  onChange,
}: {
  value: CopilotModelId
  onChange: (m: CopilotModelId) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = COPILOT_MODELS.find((m) => m.id === value)
  const isGroq = selected?.backend === 'groq'

  // Group models by backend
  const groqModels = COPILOT_MODELS.filter((m) => m.backend === 'groq')
  const openrouterModels = COPILOT_MODELS.filter((m) => m.backend === 'openrouter')

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#101928] border border-slate-700/50 hover:border-[#007AFF]/40 transition-colors text-xs text-slate-300 font-medium"
      >
        <Bot className="w-3.5 h-3.5 text-[#007AFF]" />
        {selected?.label ?? 'Select model'}
        {isGroq && (
          <span className="px-1 py-0.5 text-[8px] bg-emerald-500/15 text-emerald-400 rounded font-bold">
            GROQ
          </span>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute bottom-full mb-2 left-0 w-72 rounded-xl bg-[#0D1117] border border-slate-700/60 shadow-2xl z-50 overflow-hidden"
          >
            {/* GROQ section */}
            <div className="px-3 pt-2.5 pb-1">
              <div className="flex items-center gap-1.5 text-[9px] font-bold text-emerald-400 uppercase tracking-wider">
                <Zap className="w-3 h-3" />
                GROQ — Ultra-fast inference
              </div>
            </div>
            {groqModels.map((m) => (
              <button
                key={m.id}
                onClick={() => { onChange(m.id); setOpen(false) }}
                className={`w-full flex items-start gap-3 px-3 py-2.5 hover:bg-[#101928] transition-colors text-left ${m.id === value ? 'bg-[#007AFF]/10' : ''}`}
              >
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Zap className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-white">{m.label}</span>
                    {m.recommended && (
                      <span className="px-1 py-0.5 text-[9px] bg-[#007AFF]/20 text-[#007AFF] rounded font-bold">BEST</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500">{m.description}</div>
                </div>
                {m.id === value && <Check className="w-3.5 h-3.5 text-[#007AFF] shrink-0 mt-1" />}
              </button>
            ))}

            {/* OpenRouter section */}
            <div className="px-3 pt-2 pb-1 border-t border-slate-800/60 mt-1">
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                OpenRouter — Free tier
              </div>
            </div>
            {openrouterModels.map((m) => (
              <button
                key={m.id}
                onClick={() => { onChange(m.id); setOpen(false) }}
                className={`w-full flex items-start gap-3 px-3 py-2.5 hover:bg-[#101928] transition-colors text-left ${m.id === value ? 'bg-[#007AFF]/10' : ''}`}
              >
                <div className="w-8 h-8 rounded-lg bg-[#007AFF]/10 flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-[#007AFF]" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-white">{m.label}</span>
                  <div className="text-[10px] text-slate-500">{m.description}</div>
                </div>
                {m.id === value && <Check className="w-3.5 h-3.5 text-[#007AFF] shrink-0 mt-1" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main Copilot Desktop ──────────────────────────────────────────────────────

function DesktopCopilot() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [modelId, setModelId] = useState<CopilotModelId>(COPILOT_MODELS[0].id)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text.trim(),
        timestamp: new Date(),
      }
      const assistantMsgId = crypto.randomUUID()
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        streaming: true,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setInput('')
      setStreaming(true)

      const history: CopilotMessage[] = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }))

      abortRef.current = new AbortController()

      await streamCopilotMessage(
        history,
        modelId,
        ({ text, done, error }) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: m.content + (text ?? ''),
                    streaming: !done,
                    error: !!error,
                    ...(error ? { content: `⚠️ ${error}` } : {}),
                  }
                : m
            )
          )
        },
        abortRef.current.signal
      )

      setStreaming(false)
      abortRef.current = null
      inputRef.current?.focus()
    },
    [messages, streaming, modelId]
  )

  const stopStreaming = () => {
    abortRef.current?.abort()
    setStreaming(false)
    setMessages((prev) =>
      prev.map((m, i) =>
        i === prev.length - 1 && m.streaming ? { ...m, streaming: false } : m
      )
    )
  }

  const clearChat = () => {
    if (streaming) stopStreaming()
    setMessages([])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const hasMessages = messages.length > 0

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-5.75rem-48px)] max-h-[900px]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(0,122,255,0.1)] bg-[#0D1117]/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#007AFF]/15 border border-[#007AFF]/25 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-[#007AFF]" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white font-display">AI Copilot</h1>
              <p className="text-[10px] text-slate-500 font-mono">
                {COPILOT_MODELS.find((m) => m.id === modelId)?.backend === 'groq'
                  ? 'GROQ · Ultra-fast · Free Tier'
                  : 'OpenRouter · Free Tier'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModelSelector value={modelId} onChange={setModelId} />
            {hasMessages && (
              <button
                onClick={clearChat}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 transition-colors"
                title="New conversation"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
            {hasMessages && (
              <button
                onClick={clearChat}
                className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Clear chat"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!hasMessages ? (
            <WelcomeScreen onPrompt={(p) => sendMessage(p)} />
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Input bar */}
        <div className="shrink-0 px-5 py-4 border-t border-[rgba(0,122,255,0.1)] bg-[#0D1117]/60">
          {/* Warn only when using OpenRouter without a key */}
          {COPILOT_MODELS.find((m) => m.id === modelId)?.backend === 'openrouter' &&
           !process.env.NEXT_PUBLIC_OPENROUTER_API_KEY && (
            <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-400">
              <Zap className="w-3.5 h-3.5 shrink-0" />
              <span>
                OpenRouter key missing. Switch to a <strong>GROQ model</strong> above, or set{' '}
                <code className="font-mono bg-amber-500/10 px-1 rounded">NEXT_PUBLIC_OPENROUTER_API_KEY</code>.
              </span>
            </div>
          )}

          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  // Auto-resize
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask about any stock, sector, macro trend, options strategy…"
                disabled={streaming}
                className="w-full resize-none bg-[#101928] border border-slate-700/60 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#007AFF]/50 focus:ring-1 focus:ring-[#007AFF]/20 disabled:opacity-50 transition-colors font-sans min-h-[46px] max-h-40"
                style={{ height: '46px' }}
              />
            </div>

            {streaming ? (
              <button
                onClick={stopStreaming}
                className="h-[46px] px-4 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-colors flex items-center gap-2 shrink-0"
              >
                <StopCircle className="w-4 h-4" />
                <span className="text-xs font-medium hidden sm:block">Stop</span>
              </button>
            ) : (
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim()}
                className="h-[46px] px-4 rounded-xl bg-[#007AFF] text-white hover:bg-[#0066CC] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 shrink-0 shadow-lg shadow-[rgba(0,122,255,0.2)]"
              >
                <Send className="w-4 h-4" />
                <span className="text-xs font-semibold hidden sm:block">Send</span>
              </button>
            )}
          </div>

          <p className="text-[10px] text-slate-600 mt-2 text-center">
            Enter to send · Shift+Enter for new line · AI-generated analysis only, not financial advice
          </p>
        </div>
      </div>
    </AppLayout>
  )
}

// ─── Mobile stub (reuses desktop for now) ─────────────────────────────────────

function MobileCopilot() {
  return (
    <MobileLayout>
      <DesktopCopilot />
    </MobileLayout>
  )
}

export default function CopilotPage() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopCopilot />
      </div>
      <div className="md:hidden">
        <MobileCopilot />
      </div>
    </>
  )
}
