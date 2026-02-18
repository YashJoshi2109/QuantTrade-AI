import { TrendingUp, TrendingDown, DollarSign, BarChart3, Lightbulb, Zap, ChevronDown, ChevronUp } from 'lucide-react'
import { useRef, useState } from 'react'

interface QuickActionsProps {
  onSend: (message: string) => void
}

const actions = [
  { icon: TrendingUp, label: 'Top Gainers', prompt: "What are today's top gaining stocks?" },
  { icon: TrendingDown, label: 'Top Losers', prompt: "Show me today's biggest losing stocks" },
  { icon: DollarSign, label: 'Analyze AAPL', prompt: 'Give me a comprehensive analysis of Apple stock' },
  { icon: BarChart3, label: 'Market Summary', prompt: "What's the overall market sentiment today?" },
  { icon: Lightbulb, label: 'Trade Ideas', prompt: 'Suggest some promising stocks to invest in' },
  { icon: Zap, label: 'Quick Picks', prompt: 'Give me 3 quick stock picks for today' },
]

export default function QuickActions({ onSend }: QuickActionsProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="shrink-0 px-3 py-2">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 px-1 w-full"
      >
        {isOpen ? (
          <ChevronDown className="w-3 h-3 text-slate-600" />
        ) : (
          <ChevronUp className="w-3 h-3 text-slate-600" />
        )}
        <span className="text-[10px] text-slate-600 font-medium uppercase tracking-wider">Suggestions</span>
      </button>

      {isOpen && (
        <div
          ref={scrollRef}
          className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1 mt-1.5"
        >
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={() => onSend(action.prompt)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.12] transition-all text-[11px] text-slate-400 hover:text-white whitespace-nowrap flex-shrink-0 active:scale-[0.97]"
            >
              <action.icon className="w-3 h-3" />
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
