import { TrendingUp, Sparkles, BarChart3, Lightbulb } from 'lucide-react'

export default function WelcomeScreen() {
  return (
    <div className="text-center py-8 px-4 space-y-6 animate-fade-in">
      <div className="relative mx-auto w-24 h-24">
        <div className="absolute inset-0 bg-gradient-to-br from-[#00D9FF] to-[#0066FF] rounded-full opacity-20 animate-pulse" />
        <div className="relative w-full h-full rounded-full bg-gradient-to-br from-[#00D9FF] to-[#0066FF] flex items-center justify-center">
          <TrendingUp className="w-12 h-12 text-white" />
        </div>
      </div>
      <div>
        <h3 className="text-2xl font-bold text-white mb-2">AI Stock Analysis</h3>
        <p className="text-gray-400 text-sm max-w-xs mx-auto leading-relaxed">
          Ask me anything about stocks, market trends, or investment strategies.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto pt-4">
        {[
          { icon: Sparkles, text: 'Real-time Analysis', color: 'from-purple-500 to-pink-500' },
          { icon: BarChart3, text: 'Market Insights', color: 'from-blue-500 to-cyan-500' },
          { icon: TrendingUp, text: 'Stock Ratings', color: 'from-green-500 to-emerald-500' },
          { icon: Lightbulb, text: 'AI Predictions', color: 'from-orange-500 to-yellow-500' },
        ].map((feature, i) => (
          <div
            key={i}
            className="bg-white/5 backdrop-blur-sm rounded-xl p-3 border border-white/10"
          >
            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${feature.color} flex items-center justify-center mb-2 mx-auto`}>
              <feature.icon className="w-4 h-4 text-white" />
            </div>
            <p className="text-xs text-gray-300 font-medium">{feature.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
