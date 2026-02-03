'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, ChevronRight, Loader2, AlertCircle, Bot, Cpu, Zap } from 'lucide-react'
import { sendChatMessage, ChatResponse } from '@/lib/api'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  sources?: string[]
  error?: boolean
}

interface CopilotPanelProps {
  symbol?: string
  context?: string
  isOpen?: boolean
  onToggle?: () => void
}

export default function CopilotPanel({ symbol = 'NVDA', context = 'Market Analysis', isOpen = true, onToggle }: CopilotPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: `Hi! I'm your AI Trading Copilot. I can help you analyze ${symbol}, summarize SEC filings, and provide market insights. What would you like to know?`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    setMessages([
      {
        id: '1',
        role: 'assistant',
        content: `Hi! I'm analyzing ${symbol} for you. Ask me about price trends, technical indicators, news sentiment, or SEC filings. What would you like to know?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ])
  }, [symbol])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMessage])
    const currentInput = input
    setInput('')
    setIsLoading(true)

    try {
      const response: ChatResponse = await sendChatMessage({
        message: currentInput,
        symbol: symbol,
        include_news: true,
        include_filings: true,
        top_k: 5
      })

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.response,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sources: response.sources || [],
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `I encountered an error while processing your request. Please make sure the backend server is running at http://localhost:8000.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        error: true,
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  // Dynamic quick actions based on context and symbol
  const getQuickActions = () => {
    const actions = []
    
    // Symbol-specific actions
    if (symbol) {
      actions.push(`What's the latest news on ${symbol}?`)
      actions.push(`Analyze ${symbol} technical indicators`)
      actions.push(`What's the sentiment on ${symbol}?`)
      actions.push(`Should I buy ${symbol} now?`)
    }
    
    // Context-based actions
    if (context === 'Research') {
      actions.push(`Compare ${symbol} to competitors`)
      actions.push(`What are the key risk factors?`)
    } else if (context === 'Markets') {
      actions.push(`What sectors are performing best?`)
      actions.push(`Which stocks are most volatile today?`)
    } else if (context === 'Dashboard') {
      actions.push(`Give me a market summary`)
      actions.push(`What are today's top movers?`)
    }
    
    // General fallback actions
    if (actions.length < 4) {
      actions.push(`What's moving the market today?`)
      actions.push(`Explain recent earnings reports`)
    }
    
    return actions.slice(0, 4)
  }
  
  const quickActions = getQuickActions()

  // Minimized state - floating HUD button
  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed right-6 bottom-6 group z-50"
      >
        <div className="relative">
          {/* Animated glow rings */}
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl blur-xl opacity-40 group-hover:opacity-60 transition-opacity animate-pulse" />
          <div className="absolute -inset-2 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl blur-2xl opacity-20 group-hover:opacity-30 transition-opacity" />
          
          {/* Button */}
          <div className="relative w-16 h-16 bg-gradient-to-br from-blue-500 via-blue-600 to-cyan-500 rounded-2xl flex items-center justify-center shadow-2xl shadow-blue-500/40 group-hover:scale-110 group-hover:shadow-blue-500/60 transition-all duration-300">
            <div className="absolute inset-[2px] bg-gradient-to-br from-blue-400/20 to-transparent rounded-2xl" />
            <div className="relative flex flex-col items-center gap-0.5">
              <Sparkles className="w-6 h-6 text-white" />
              <span className="text-[8px] font-bold text-white/90 tracking-wider">AI</span>
            </div>
            {/* Active indicator */}
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-[#0d1321] animate-pulse" />
          </div>
          
          {/* Enhanced Tooltip */}
          <div className="absolute right-full mr-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none">
            <div className="hud-panel px-4 py-2.5 shadow-xl">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-bold text-white">Open AI Copilot</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 font-mono">Ask me anything</div>
            </div>
          </div>
        </div>
      </button>
    )
  }

  return (
    <aside className="w-80 h-full flex flex-col">
      {/* Background */}
      <div className="absolute inset-0 bg-[#0d1321]/95 backdrop-blur-xl border-l border-blue-500/10" />
      
      {/* Content */}
      <div className="relative h-full flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-blue-500/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-[#0d1321] animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  Copilot
                  <Zap className="w-3 h-3 text-cyan-400" />
                </h3>
                <div className="text-[10px] text-slate-400 font-mono">AI-POWERED ANALYSIS</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hud-stat px-3 py-1.5 text-[10px] font-bold text-cyan-400 flex items-center gap-1.5">
                <Cpu className="w-3 h-3" />
                {symbol}
              </div>
              <button
                onClick={onToggle}
                className="p-2 text-slate-400 hover:text-white hud-card transition-all"
                title="Minimize"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="text-[10px] text-center text-slate-600 font-mono tracking-wider mb-4">
            ── SESSION START ──
          </div>
          
          {messages.map((message) => (
            <div key={message.id} className="flex flex-col space-y-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {message.role === 'user' ? (
                // User message
                <div className="ml-auto max-w-[85%]">
                  <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-2xl rounded-tr-sm p-3 shadow-lg shadow-blue-500/20">
                    <p className="text-sm">{message.content}</p>
                  </div>
                  <div className="text-[10px] text-slate-500 text-right mt-1 font-mono">
                    YOU · {message.timestamp}
                  </div>
                </div>
              ) : (
                // Assistant message
                <div className="mr-auto max-w-[90%]">
                  <div className={`hud-panel p-3 ${message.error ? 'border-red-500/30' : ''}`}>
                    {message.error && (
                      <div className="flex items-center gap-1.5 mb-2 text-red-400 text-xs font-medium">
                        <AlertCircle className="w-3 h-3" />
                        Connection Error
                      </div>
                    )}
                    <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    
                    {/* Sources */}
                    {message.sources && message.sources.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-700/50">
                        <p className="hud-label mb-2">SOURCES</p>
                        <div className="flex flex-wrap gap-1.5">
                          {message.sources.slice(0, 4).map((source, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] px-2 py-1 bg-blue-500/10 text-blue-400 rounded-md border border-blue-500/20 font-medium"
                            >
                              {source}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1 font-mono flex items-center gap-1.5">
                    <Bot className="w-3 h-3 text-cyan-400" />
                    AI COPILOT · {message.timestamp}
                  </div>
                </div>
              )}
            </div>
          ))}
          
          {isLoading && (
            <div className="mr-auto max-w-[90%] animate-in fade-in duration-300">
              <div className="hud-panel p-4">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                    <div className="absolute inset-0 blur-md bg-blue-400/50" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 font-medium">Processing query...</span>
                    <div className="text-[10px] text-slate-600 font-mono">ANALYZING DATA</div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Actions */}
        <div className="px-4 py-3 border-t border-blue-500/10">
          <p className="hud-label mb-2">QUICK ACTIONS</p>
          <div className="flex flex-wrap gap-2">
            {quickActions.map((action, idx) => (
              <button
                key={idx}
                onClick={() => setInput(action)}
                className="hud-card px-3 py-1.5 text-[11px] text-slate-300 hover:text-cyan-400 hover:border-cyan-500/30 transition-all"
              >
                {action}
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="p-4 border-t border-blue-500/10">
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500/10 to-cyan-500/10 blur-sm" />
            <div className="relative hud-card overflow-hidden flex items-center">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Ask about ${symbol}...`}
                className="flex-1 px-4 py-3 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="m-1.5 p-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </aside>
  )
}
