import { Sparkles, BarChart3, Lightbulb, Activity, BrainCircuit, TrendingUp } from 'lucide-react'

const features = [
  { icon: Sparkles, label: 'Real-time Analysis', desc: 'Live market data' },
  { icon: BarChart3, label: 'Market Insights', desc: 'Sector trends' },
  { icon: TrendingUp, label: 'Stock Ratings', desc: 'Buy/sell signals' },
  { icon: BrainCircuit, label: 'AI Predictions', desc: 'ML forecasts' },
  { icon: Activity, label: 'Portfolio Review', desc: 'Risk analysis' },
  { icon: Lightbulb, label: 'Smart Ideas', desc: 'Trade setups' },
]

export default function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-6 animate-fade-in">
      {/* Title */}
      <h3 className="text-xl font-bold text-white mb-1.5 tracking-tight">
        Quant AI Assistant
      </h3>
      <p className="text-[13px] text-slate-400 text-center max-w-[260px] leading-relaxed mb-6">
        Ask about any stock, market trend, or investment strategy. Powered by real-time data.
      </p>

      {/* Feature chips — horizontal scroll */}
      <div className="w-full overflow-x-auto scrollbar-hide -mx-4 px-4">
        <div className="flex gap-2.5 pb-1 w-max">
          {features.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-white/[0.04] backdrop-blur-md border border-white/[0.08] hover:bg-white/[0.07] hover:border-white/[0.15] transition-all cursor-default group"
            >
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#00D9FF]/20 to-[#7C3AED]/20 flex items-center justify-center border border-white/[0.06] group-hover:border-cyan-500/20 transition-colors">
                <f.icon className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-left">
                <p className="text-[11px] font-semibold text-white/90 leading-none">{f.label}</p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-none">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Subtle hint */}
      <div className="mt-6 flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.03] border border-white/[0.06]">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <p className="text-[10px] text-slate-500">
          Try: <span className="text-slate-400">&quot;Analyze NVDA&quot;</span> or <span className="text-slate-400">&quot;Top gainers today&quot;</span>
        </p>
      </div>
    </div>
  )
}
