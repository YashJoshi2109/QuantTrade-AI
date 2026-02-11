import { TrendingUp, TrendingDown, DollarSign, BarChart3, Lightbulb, Zap, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'

interface QuickActionsProps {
  onSend: (message: string) => void
}

export default function QuickActions({ onSend }: QuickActionsProps) {
  const [isOpen, setIsOpen] = useState(true)
  const actions = [
    { icon: TrendingUp, label: 'Top Gainers', prompt: "What are today's top gaining stocks?" },
    { icon: TrendingDown, label: 'Top Losers', prompt: "Show me today's biggest losing stocks" },
    { icon: DollarSign, label: 'Analyze AAPL', prompt: 'Give me a comprehensive analysis of Apple stock' },
    { icon: BarChart3, label: 'Market Summary', prompt: "What's the overall market sentiment today?" },
    { icon: Lightbulb, label: 'Investment Ideas', prompt: 'Suggest some promising stocks to invest in' },
    { icon: Zap, label: 'Quick Picks', prompt: 'Give me 3 quick stock picks for today' },
  ]

  return (
    <div className="shrink-0 border-t border-white/10 px-4 py-2 bg-[#0A0E1A]/50">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between text-xs text-gray-500 font-medium mb-1.5"
      >
        <span>Quick Actions</span>
        {isOpen ? (
          <ChevronUp className="w-3 h-3 text-gray-500" />
        ) : (
          <ChevronDown className="w-3 h-3 text-gray-500" />
        )}
      </button>
      {isOpen && (
        <div className="mt-1 flex flex-wrap gap-2">
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={() => onSend(action.prompt)}
              className="px-3 py-2 bg-[#1A2332] hover:bg-[#1A2332]/80 border border-white/10 hover:border-[#00D9FF]/50 rounded-xl text-xs text-gray-300 hover:text-white transition-all flex items-center gap-2"
            >
              <action.icon className="w-3.5 h-3.5" />
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
