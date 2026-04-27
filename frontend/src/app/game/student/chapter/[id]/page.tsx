'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Swords } from 'lucide-react'

import { CHAPTER_MAP, Chapter, Choice, MarketSellConfig, SavingsGoalConfig, LoanCompareConfig, TrustCheckConfig, AssetBuyConfig, AllocateConfig } from '@/lib/student-chapters'
import { useStudentStore } from '@/lib/student-store'
import { NpcDialogue } from '@/components/game/student/NpcDialogue'
import { MissionChoice } from '@/components/game/student/MissionChoice'
import { DailyReflection } from '@/components/game/student/DailyReflection'
import { RoofMeter } from '@/components/game/student/RoofMeter'
import { Ledger } from '@/components/game/student/Ledger'
import { SavingsBuckets } from '@/components/game/student/SavingsBuckets'

// ─── Stage machine ────────────────────────────────────────────────────────────
type Stage = 'intro' | 'mechanic' | 'choice' | 'reflection'

// ─── Market Sell Mechanic ─────────────────────────────────────────────────────
function MarketSellMechanic({ config, onComplete }: { config: MarketSellConfig; onComplete: (netGold: number) => void }) {
  const [selectedStall, setSelectedStall] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const [gross, setGross] = useState(0)
  const [net, setNet] = useState(0)

  function sellAtStall(stallIdx: number) {
    if (done) return
    const stall = config.stalls[stallIdx]!
    const grossEarned = Math.round(
      config.items.reduce((sum, item) => sum + item.qty * item.basePrice, 0) * stall.bonus
    )
    const totalCosts = config.costs.reduce((s, c) => s + c.amount, 0)
    const netEarned = grossEarned - totalCosts
    setSelectedStall(stallIdx)
    setGross(grossEarned)
    setNet(netEarned)
    setDone(true)
    setTimeout(() => onComplete(netEarned), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-amber-400/70 uppercase tracking-widest font-semibold mb-3">
        Choose your selling location
      </div>

      {/* Goods to sell */}
      <div className="rounded-xl bg-white/3 border border-line-subtle p-3">
        <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2">Today's Goods</div>
        <div className="flex gap-3 flex-wrap">
          {config.items.map((item) => (
            <div key={item.name} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-line-default">
              <span>{item.emoji}</span>
              <span className="text-xs text-white/70">{item.name}</span>
              <span className="text-[10px] text-amber-400/70">{item.qty}×{item.basePrice}s</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stall choices */}
      <div className="grid gap-2">
        {config.stalls.map((stall, i) => {
          const isSelected = selectedStall === i
          const multiplierLabel = stall.bonus >= 1.2 ? '🔥 High demand' : stall.bonus < 1 ? '📉 Low demand' : '⚖️ Fair price'
          return (
            <motion.button
              key={i}
              whileHover={!done ? { scale: 1.01 } : {}}
              whileTap={!done ? { scale: 0.99 } : {}}
              onClick={() => sellAtStall(i)}
              disabled={done}
              className={`w-full text-left rounded-xl border p-3.5 transition-all ${
                isSelected ? 'border-amber-500/50 bg-amber-500/10' : 'border-line-subtle bg-white/3 hover:border-line-default'
              } ${done ? 'opacity-60' : 'cursor-pointer'}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-white/90">{stall.name}</span>
                <span className="text-[10px] font-bold text-amber-400">{multiplierLabel}</span>
              </div>
              <div className="text-xs text-white/45">{stall.description}</div>
              <div className="text-[10px] text-amber-400/60 mt-1">
                Estimated: ×{stall.bonus} on base price
              </div>
            </motion.button>
          )
        })}
      </div>

      {/* Result */}
      <AnimatePresence>
        {done && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-4 space-y-2"
          >
            <div className="text-xs text-emerald-400/70 uppercase tracking-wider font-semibold">End of Market Day</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/50">Gross earned</span>
                <span className="text-emerald-400 font-mono font-bold">+{gross}s</span>
              </div>
              {config.costs.map((c) => (
                <div key={c.label} className="flex justify-between col-span-2">
                  <span className="text-white/40 text-xs">{c.label}</span>
                  <span className="text-red-400 font-mono text-xs">-{c.amount}s</span>
                </div>
              ))}
              <div className="col-span-2 border-t border-line-default pt-2 flex justify-between font-bold">
                <span className="text-white/80">Net kept</span>
                <span className="text-amber-300 font-mono">+{net}s</span>
              </div>
            </div>
            <p className="text-xs text-amber-400/70 italic mt-2">
              "Earning is not the same as keeping." — Merchant Rafiq
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Savings Goal Mechanic ────────────────────────────────────────────────────
function SavingsGoalMechanic({ config, onComplete }: { config: SavingsGoalConfig; onComplete: (saved: number) => void }) {
  const [saved, setSaved] = useState(0)
  const [daysSpent, setDaysSpent] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const done = saved >= config.targetAmount || daysSpent >= config.deadlineDays
  const daysLeft = config.deadlineDays - daysSpent

  function saveDay() {
    if (done) return
    const dailySave = config.dailySalary
    setSaved((s) => Math.min(config.targetAmount, s + dailySave))
    setDaysSpent((d) => d + 1)
    setLog((l) => [...l, `Day ${daysSpent + 1}: Saved ${dailySave}s`])
  }

  function spendTemptation(t: { label: string; cost: number; emoji: string }) {
    if (done) return
    setDaysSpent((d) => d + 1)
    setLog((l) => [...l, `Day ${daysSpent + 1}: Spent ${t.cost}s on ${t.label} 😬`])
  }

  return (
    <div className="space-y-4">
      <RoofMeter
        current={saved}
        target={config.targetAmount}
        label={config.targetLabel}
        deadlineDays={config.deadlineDays}
        daysLeft={daysLeft}
      />

      {!done ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={saveDay}
              className="col-span-2 py-3 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-500 text-white font-bold text-sm hover:opacity-90 transition-opacity"
            >
              💎 Work & save {config.dailySalary}s today
            </button>
            {config.temptations.map((t) => (
              <button
                key={t.label}
                onClick={() => spendTemptation(t)}
                className="py-2 rounded-xl border border-line-default bg-white/5 text-white/60 text-xs hover:bg-white/10 transition-colors"
              >
                {t.emoji} Spend {t.cost}s on {t.label}
              </button>
            ))}
          </div>
          <div className="text-xs text-white/40 text-center">{daysLeft} days until winter</div>
        </>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-2"
        >
          <div className={`rounded-xl p-3 text-center font-bold text-sm ${
            saved >= config.targetAmount
              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/15 border border-red-500/30 text-red-300'
          }`}>
            {saved >= config.targetAmount ? '🏠 Goal reached! Roof repaired before winter!' : `❌ Winter arrived! Short ${config.targetAmount - saved}s`}
          </div>
          <button
            onClick={() => onComplete(saved)}
            className="w-full py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 font-semibold text-sm hover:bg-amber-500/30 transition-colors"
          >
            Continue →
          </button>
        </motion.div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div className="rounded-xl bg-white/3 border border-line-subtle p-3 max-h-28 overflow-y-auto">
          <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Activity Log</div>
          {log.map((entry, i) => (
            <div key={i} className="text-xs text-white/50 py-0.5">{entry}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Loan Compare Mechanic ────────────────────────────────────────────────────
function LoanCompareMechanic({ config, onComplete }: { config: LoanCompareConfig; onComplete: (choice: string) => void }) {
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="space-y-3">
      <div className="text-xs text-white/50 mb-3">
        You need <span className="text-amber-300 font-bold">{config.amount} silver</span> urgently. Compare your options:
      </div>
      {config.options.map((opt, i) => {
        const totalRepay = opt.rate === 0 ? 0 : Math.round(config.amount * (1 + opt.rate / 100))
        const interest = totalRepay - config.amount
        const isSelected = selected === i

        return (
          <motion.button
            key={i}
            onClick={() => { setSelected(i); setTimeout(() => onComplete(opt.label), 800) }}
            disabled={selected !== null}
            className={`w-full text-left rounded-xl border p-4 transition-all ${
              isSelected ? 'border-amber-500/50 bg-amber-500/10' :
              opt.isGood ? 'border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/40'
              : 'border-red-500/20 bg-red-500/5 hover:border-red-500/40'
            } ${selected !== null && !isSelected ? 'opacity-40' : 'cursor-pointer'}`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">{opt.emoji}</span>
                <span className="font-bold text-sm text-white/90">{opt.label}</span>
              </div>
              {opt.isGood
                ? <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">FAIR</span>
                : opt.rate > 0 ? <span className="text-[9px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 font-bold">DANGER</span> : null
              }
            </div>
            {opt.rate > 0 && (
              <div className="grid grid-cols-3 gap-2 text-center mt-2">
                <div>
                  <div className="text-[9px] text-white/30 uppercase">Borrow</div>
                  <div className="font-mono font-bold text-white/80 text-sm">{config.amount}s</div>
                </div>
                <div>
                  <div className="text-[9px] text-white/30 uppercase">Interest</div>
                  <div className={`font-mono font-bold text-sm ${opt.isGood ? 'text-yellow-400' : 'text-red-400'}`}>+{interest}s</div>
                </div>
                <div>
                  <div className="text-[9px] text-white/30 uppercase">Repay in</div>
                  <div className="font-mono font-bold text-white/80 text-sm">{opt.term}d</div>
                </div>
              </div>
            )}
          </motion.button>
        )
      })}
    </div>
  )
}

// ─── Trust Check Mechanic ─────────────────────────────────────────────────────
function TrustCheckMechanic({ config, onComplete }: { config: TrustCheckConfig; onComplete: (passed: boolean) => void }) {
  const [idx, setIdx] = useState(0)
  const [verdict, setVerdict] = useState<'scam' | 'legit' | null>(null)
  const [score, setScore] = useState(0)
  const current = config.scams[idx]!

  function answer(choice: 'scam' | 'legit') {
    const correct = choice === current.verdict
    setVerdict(choice)
    if (correct) setScore((s) => s + 1)
    setTimeout(() => {
      if (idx < config.scams.length - 1) {
        setIdx((i) => i + 1)
        setVerdict(null)
      } else {
        onComplete(score + (correct ? 1 : 0) >= Math.ceil(config.scams.length / 2))
      }
    }, 2000)
  }

  const checks = ['Source verified?', 'Return realistic?', 'Risk explained?', 'Exit possible?']

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-white/40 mb-2">
        <span>Offer {idx + 1} of {config.scams.length}</span>
        <span className="text-amber-400 font-mono">Score: {score}</span>
      </div>

      {/* Offer card */}
      <div className="rounded-xl bg-purple-900/20 border border-purple-500/25 p-4">
        <div className="text-[10px] text-purple-400/70 uppercase tracking-wider font-semibold mb-2">The Offer</div>
        <p className="text-sm text-white/85 leading-relaxed italic">{current.pitch}</p>
      </div>

      {/* Trust Check grid */}
      <div className="grid grid-cols-2 gap-2">
        {checks.map((check, i) => {
          const hasFlag = current.redFlags[i] !== undefined
          return (
            <div key={check} className={`rounded-lg p-2.5 border text-xs flex items-center gap-2 ${
              hasFlag ? 'border-red-500/30 bg-red-500/8 text-red-300' : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400'
            }`}>
              <span>{hasFlag ? '❌' : '✅'}</span>
              <span>{check}</span>
            </div>
          )
        })}
      </div>

      {/* Red flags */}
      {current.redFlags.length > 0 && (
        <div className="rounded-xl bg-red-500/8 border border-red-500/20 p-3">
          <div className="text-[10px] text-red-400 uppercase tracking-wider font-semibold mb-1.5">Red Flags Detected</div>
          <ul className="space-y-1">
            {current.redFlags.map((flag, i) => (
              <li key={i} className="text-xs text-red-300/80 flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">⚠️</span>
                <span>{flag}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Verdict buttons */}
      {!verdict ? (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => answer('scam')}
            className="py-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 font-bold text-sm hover:bg-red-500/20 transition-colors"
          >
            🚫 This is a Scam
          </button>
          <button
            onClick={() => answer('legit')}
            className="py-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-bold text-sm hover:bg-emerald-500/20 transition-colors"
          >
            ✅ Looks Legitimate
          </button>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-xl p-4 border ${
            verdict === current.verdict
              ? 'border-emerald-500/40 bg-emerald-500/10'
              : 'border-red-500/40 bg-red-500/10'
          }`}
        >
          <div className={`font-bold text-sm mb-1 ${verdict === current.verdict ? 'text-emerald-300' : 'text-red-300'}`}>
            {verdict === current.verdict ? '✓ Correct!' : '✗ Wrong!'} — This was a {current.verdict}.
          </div>
          <p className="text-xs text-white/60">{current.explanation}</p>
        </motion.div>
      )}
    </div>
  )
}

// ─── Asset Buy Mechanic ───────────────────────────────────────────────────────
function AssetBuyMechanic({ config, onComplete }: { config: AssetBuyConfig; onComplete: (units: number) => void }) {
  const [units, setUnits] = useState(1)
  const [bought, setBought] = useState(false)
  const [seasonResult, setSeasonResult] = useState<{ label: string; returnPct: number; emoji: string } | null>(null)
  const totalCost = units * config.unitCost

  function buy() {
    const season = config.seasons[Math.floor(Math.random() * config.seasons.length)]!
    setBought(true)
    setSeasonResult(season)
  }

  const returnAmount = seasonResult ? Math.round(totalCost * (1 + seasonResult.returnPct / 100)) : 0

  return (
    <div className="space-y-4">
      {!bought ? (
        <>
          <div className="rounded-xl bg-white/3 border border-line-subtle p-4 text-center">
            <div className="text-3xl mb-2">{config.emoji}</div>
            <div className="font-bold text-white/90 mb-1">{config.asset}</div>
            <div className="text-sm text-white/50">{config.unitCost} silver per unit</div>
            <div className="text-[10px] text-white/30 mt-1">
              Returns vary by harvest: {config.seasons.map((s) => `${s.returnPct}%`).join(' / ')}
            </div>
          </div>

          <div className="flex items-center gap-3 justify-center">
            <button onClick={() => setUnits((u) => Math.max(1, u - 1))}
              className="w-8 h-8 rounded-lg bg-white/10 text-white font-bold hover:bg-white/20 transition-colors">-</button>
            <div className="text-center">
              <div className="font-bold text-xl text-white">{units}</div>
              <div className="text-[10px] text-white/40">units</div>
            </div>
            <button onClick={() => setUnits((u) => Math.min(config.maxUnits, u + 1))}
              className="w-8 h-8 rounded-lg bg-white/10 text-white font-bold hover:bg-white/20 transition-colors">+</button>
          </div>

          <div className="rounded-xl bg-amber-500/8 border border-amber-500/20 p-3 flex justify-between items-center">
            <span className="text-sm text-amber-300/80">Total investment</span>
            <span className="font-bold font-mono text-amber-300 text-lg">{totalCost}s</span>
          </div>

          <button onClick={buy}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-500 text-[#060B12] font-bold text-sm hover:opacity-90 transition-opacity">
            Buy {units} {config.asset}{units > 1 ? 's' : ''}
          </button>
          <button onClick={() => onComplete(0)}
            className="w-full py-2 rounded-xl border border-line-default text-white/40 text-sm hover:bg-white/5 transition-colors">
            Skip — too risky
          </button>
        </>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          <div className="text-center rounded-xl bg-white/5 border border-line-default p-4">
            <div className="text-3xl mb-2">{seasonResult?.emoji}</div>
            <div className="font-bold text-white/90 mb-1">{seasonResult?.label}</div>
            <div className="text-sm text-white/50">Return: {seasonResult?.returnPct}%</div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-white/5 p-2">
              <div className="text-[10px] text-white/30">Invested</div>
              <div className="font-mono font-bold text-red-400">-{totalCost}s</div>
            </div>
            <div className="rounded-lg bg-white/5 p-2">
              <div className="text-[10px] text-white/30">Return</div>
              <div className="font-mono font-bold text-emerald-400">+{returnAmount}s</div>
            </div>
            <div className="rounded-lg bg-white/5 p-2">
              <div className="text-[10px] text-white/30">Profit</div>
              <div className={`font-mono font-bold ${returnAmount - totalCost >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {returnAmount - totalCost >= 0 ? '+' : ''}{returnAmount - totalCost}s
              </div>
            </div>
          </div>
          <button onClick={() => onComplete(units)}
            className="w-full py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 font-semibold text-sm">
            Continue →
          </button>
        </motion.div>
      )}
    </div>
  )
}

// ─── Allocation Wheel Mechanic ────────────────────────────────────────────────
function AllocationMechanic({ config, onComplete }: { config: AllocateConfig; onComplete: () => void }) {
  const equal = Math.floor(config.totalGold / config.buckets.length)
  const [allocs, setAllocs] = useState<Record<string, number>>(
    Object.fromEntries(config.buckets.map((b) => [b.id, equal]))
  )
  const total = Object.values(allocs).reduce((a, b) => a + b, 0)
  const remaining = config.totalGold - total

  function adjust(id: string, delta: number) {
    setAllocs((prev) => ({
      ...prev,
      [id]: Math.max(0, (prev[id] ?? 0) + delta),
    }))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs mb-3">
        <span className="text-white/50">Total to allocate: {config.totalGold}s</span>
        <span className={remaining === 0 ? 'text-emerald-400' : remaining > 0 ? 'text-amber-400' : 'text-red-400'}>
          {remaining === 0 ? '✓ Fully allocated' : remaining > 0 ? `${remaining}s unallocated` : `${-remaining}s over`}
        </span>
      </div>

      {/* Visual bar */}
      <div className="h-4 rounded-full overflow-hidden flex gap-0.5 bg-white/5 border border-line-default">
        {config.buckets.map((b) => (
          <div
            key={b.id}
            className="h-full transition-all duration-300"
            style={{
              width: `${(allocs[b.id]! / config.totalGold) * 100}%`,
              backgroundColor: b.color,
            }}
          />
        ))}
      </div>

      {/* Bucket sliders */}
      {config.buckets.map((b) => (
        <div key={b.id} className="rounded-xl bg-white/3 border border-line-subtle p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: b.color }} />
              <span className="text-sm font-semibold text-white/80">{b.emoji} {b.label}</span>
              <span className="text-[10px] text-white/35 border border-line-default rounded-full px-1.5 py-0.5">{b.riskLabel}</span>
            </div>
            <span className="font-mono font-bold text-sm" style={{ color: b.color }}>{allocs[b.id]}s</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => adjust(b.id, -5)} className="px-2 py-1 rounded text-xs bg-white/10 text-white/60 hover:bg-white/20">-5</button>
            <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${(allocs[b.id]! / config.totalGold) * 100}%`, backgroundColor: b.color }} />
            </div>
            <button onClick={() => adjust(b.id, 5)} className="px-2 py-1 rounded text-xs bg-white/10 text-white/60 hover:bg-white/20">+5</button>
          </div>
        </div>
      ))}

      <button
        onClick={onComplete}
        disabled={remaining !== 0}
        className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
          remaining === 0
            ? 'bg-gradient-to-r from-amber-600 to-yellow-500 text-[#060B12] hover:opacity-90'
            : 'bg-white/5 border border-line-default text-white/30 cursor-not-allowed'
        }`}
      >
        Confirm Allocation
      </button>
    </div>
  )
}

// ─── Graduation Mechanic ──────────────────────────────────────────────────────
function GraduationMechanic({ config, completedChapters, onComplete }: { config: { requirements: Array<{ label: string; chapterId: string; emoji: string }> }; completedChapters: string[]; onComplete: () => void }) {
  const fulfilled = config.requirements.filter((r) => completedChapters.includes(r.chapterId))
  const allDone = fulfilled.length === config.requirements.length

  return (
    <div className="space-y-3">
      <div className="text-xs text-white/50 mb-3">
        Complete all requirements to enter the Trade Academy:
      </div>
      {config.requirements.map((req) => {
        const done = completedChapters.includes(req.chapterId)
        return (
          <div key={req.chapterId} className={`flex items-center gap-3 p-3 rounded-xl border ${
            done ? 'border-emerald-500/30 bg-emerald-500/8' : 'border-line-subtle bg-white/3 opacity-60'
          }`}>
            <span className="text-xl">{req.emoji}</span>
            <span className={`text-sm flex-1 ${done ? 'text-emerald-300' : 'text-white/60'}`}>{req.label}</span>
            <span>{done ? '✓' : '○'}</span>
          </div>
        )
      })}
      {allDone && (
        <motion.button
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={onComplete}
          className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-600 via-yellow-500 to-amber-400 text-[#060B12] font-bold text-base hover:opacity-90 transition-opacity"
        >
          🎓 Enter the Trade Academy
        </motion.button>
      )}
    </div>
  )
}

// ─── Main chapter page ────────────────────────────────────────────────────────
export default function ChapterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const chapter = CHAPTER_MAP[id]

  const {
    gold, savings, emergency, debt, xp, level,
    ledger, dayNumber, completedChapters,
    completeChapter, applyChoiceResult, addLedgerEntry,
    buyAsset, depositToVault, setRoofRepaired, advanceDay,
    currentGoalSaved, currentGoalTarget,
  } = useStudentStore()

  const [stage, setStage] = useState<Stage>('intro')
  const [mechanicDone, setMechanicDone] = useState(false)
  const [mechanicGoldDelta, setMechanicGoldDelta] = useState(0)
  const [selectedChoice, setSelectedChoice] = useState<Choice | null>(null)

  if (!chapter) {
    return (
      <div className="min-h-screen bg-[#080810] flex items-center justify-center text-white">
        <div className="text-center">
          <div className="text-4xl mb-4">🗺️</div>
          <div className="text-xl font-bold mb-2">Chapter not found</div>
          <button onClick={() => router.push('/game/student')} className="text-amber-400 hover:underline">
            ← Back to Ashmarket
          </button>
        </div>
      </div>
    )
  }

  function handleDialogueComplete() {
    setStage('mechanic')
  }

  function handleMechanicComplete(goldDelta: number = 0) {
    setMechanicGoldDelta(goldDelta)
    setMechanicDone(true)
    setStage('choice')
    if (goldDelta !== 0) {
      addLedgerEntry({
        label: `${chapter.title} — mechanic result`,
        amount: goldDelta,
        category: goldDelta > 0 ? 'earn' : 'spend',
        chapterId: chapter.id,
        day: dayNumber,
      })
    }
    // Special handling for roof chapter
    if (chapter.mechanicType === 'savings_goal' && goldDelta >= (chapter.mechanicConfig as SavingsGoalConfig).targetAmount) {
      setRoofRepaired(true)
    }
  }

  function handleChoice(choice: Choice) {
    setSelectedChoice(choice)
    applyChoiceResult({
      chapterId: chapter.id,
      goldDelta: choice.goldDelta + mechanicGoldDelta,
      savingsDelta: choice.savingsDelta,
      emergencyDelta: choice.emergencyDelta,
      debtDelta: choice.debtDelta,
      xpReward: choice.xpReward + chapter.xpReward,
      label: `${chapter.title}: ${choice.label}`,
    })
    completeChapter(chapter.id)
    advanceDay()
    setStage('reflection')
  }

  function handleReflectionContinue() {
    router.push('/game/student')
  }

  const stageColor = chapter.npcColor

  return (
    <div className="min-h-screen bg-[#080810] text-white flex flex-col" style={{ fontFamily: 'DM Sans, system-ui' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');`}</style>

      {/* Ambient bg */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-96 h-96 rounded-full blur-3xl opacity-30"
          style={{ backgroundColor: `${stageColor}20` }} />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-blue-900/10 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-3 border-b border-line-subtle bg-[#080810]/80 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/game/student')}
            className="flex items-center gap-1.5 text-white/40 hover:text-white/70 transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Ashmarket
          </button>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <Swords className="w-4 h-4" style={{ color: stageColor }} />
            <span className="text-sm font-bold" style={{ color: stageColor }}>
              Chapter {chapter.number}
            </span>
            <span className="text-white/30 text-xs">·</span>
            <span className="text-white/60 text-xs">{chapter.title}</span>
          </div>
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-3 text-xs">
          <span className="text-white/40">Day {dayNumber}</span>
          <span className="font-mono text-amber-400">🪙 {gold}s</span>
          <span className="font-mono text-sky-400">💎 {savings}s</span>
          <span className="font-mono text-emerald-400">❄️ {emergency}s</span>
          {debt > 0 && <span className="font-mono text-red-400">📜 -{debt}s</span>}
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 relative z-10 flex gap-0 overflow-hidden">

        {/* ── Left: Story & Mechanic ── */}
        <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">

          {/* Chapter hero */}
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <div className="text-[10px] text-white/30 uppercase tracking-widest font-semibold mb-1 flex items-center gap-2">
              <span style={{ color: stageColor }}>■</span>
              {chapter.location} · Ch.{chapter.number} of 10
            </div>
            <h1 className="text-2xl font-bold mb-0.5" style={{ fontFamily: 'Syne, serif', color: stageColor }}>
              {chapter.title}
            </h1>
            <h2 className="text-base text-white/50 italic">{chapter.subtitle}</h2>
          </motion.div>

          <AnimatePresence mode="wait">

            {/* INTRO: NPC dialogue */}
            {stage === 'intro' && (
              <motion.div key="intro" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }}>
                <NpcDialogue
                  lines={chapter.storyLines}
                  npcColor={stageColor}
                  onComplete={handleDialogueComplete}
                />
                <div className="mt-4 text-xs text-white/25 text-center">
                  Read the full dialogue to continue
                </div>
              </motion.div>
            )}

            {/* MECHANIC */}
            {stage === 'mechanic' && (
              <motion.div key="mechanic" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                <div className="mb-4 rounded-xl bg-white/3 border border-line-subtle px-4 py-3">
                  <div className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">Mission</div>
                  <div className="text-sm text-white/75">{chapter.subtitle}</div>
                </div>

                {chapter.mechanicType === 'market_sell' && (
                  <MarketSellMechanic
                    config={chapter.mechanicConfig as MarketSellConfig}
                    onComplete={handleMechanicComplete}
                  />
                )}
                {chapter.mechanicType === 'ledger_review' && (
                  <div>
                    <Ledger
                      entries={(chapter.mechanicConfig as { entries: any[] }).entries.map((e, i) => ({
                        id: `demo_${i}`,
                        label: e.label,
                        amount: e.amount,
                        category: e.amount > 0 ? 'earn' : e.category === 'want' ? 'spend' : 'spend',
                        chapterId: chapter.id,
                        day: dayNumber,
                        timestamp: Date.now() - i * 1000,
                      }))}
                      title="Your Weekly Ledger"
                      showSummary
                    />
                    <button
                      onClick={() => handleMechanicComplete(0)}
                      className="w-full mt-4 py-3 rounded-xl bg-amber-500/20 border border-amber-500/35 text-amber-300 font-semibold text-sm hover:bg-amber-500/30 transition-colors"
                    >
                      I understand my spending patterns →
                    </button>
                  </div>
                )}
                {chapter.mechanicType === 'savings_goal' && (
                  <SavingsGoalMechanic
                    config={chapter.mechanicConfig as SavingsGoalConfig}
                    onComplete={(saved) => handleMechanicComplete(saved)}
                  />
                )}
                {chapter.mechanicType === 'vault_deposit' && (
                  <div>
                    <div className="rounded-xl bg-blue-900/20 border border-blue-500/20 p-4 mb-4 text-center">
                      <div className="text-3xl mb-2">🏦</div>
                      <div className="text-sm text-white/70">Current gold available: <span className="text-amber-300 font-bold font-mono">{gold}s</span></div>
                    </div>
                    <div className="rounded-xl bg-white/3 border border-line-subtle p-3 text-xs text-white/50 text-center mb-4">
                      The Guild Vault earns 4% monthly interest. Withdrawal has a 12-hour delay.
                    </div>
                    <button
                      onClick={() => { depositToVault(Math.floor(gold * 0.8)); handleMechanicComplete(0) }}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-700 to-blue-600 text-white font-bold text-sm mb-2 hover:opacity-90"
                    >
                      🔒 Deposit 80% into Guild Vault ({Math.floor(gold * 0.8)}s)
                    </button>
                    <button onClick={() => handleMechanicComplete(0)}
                      className="w-full py-2.5 rounded-xl border border-line-default text-white/40 text-sm hover:bg-white/5">
                      Keep at home for now
                    </button>
                  </div>
                )}
                {chapter.mechanicType === 'emergency_fund' && (
                  <div>
                    <div className="rounded-xl bg-red-900/20 border border-red-500/25 p-4 mb-4">
                      <div className="text-3xl text-center mb-2">🛞</div>
                      <div className="text-sm text-white/70 text-center">Cart wheel broken! Repair costs <span className="text-red-400 font-bold">15 silver</span></div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-white/50 mb-4">
                      <div className="rounded-lg bg-white/3 border border-line-subtle p-2 text-center">
                        <div className="text-white/30 mb-0.5">Emergency reserve</div>
                        <div className="font-mono font-bold text-emerald-400">{emergency}s</div>
                      </div>
                      <div className="rounded-lg bg-white/3 border border-line-subtle p-2 text-center">
                        <div className="text-white/30 mb-0.5">Liquid gold</div>
                        <div className="font-mono font-bold text-amber-400">{gold}s</div>
                      </div>
                    </div>
                    <button onClick={() => handleMechanicComplete(0)}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-700 to-emerald-600 text-white font-bold text-sm mb-2 hover:opacity-90">
                      ❄️ Use Winter Reserve (15s)
                    </button>
                    <button onClick={() => handleMechanicComplete(-48)}
                      className="w-full py-2.5 rounded-xl border border-red-500/25 bg-red-500/8 text-red-400 text-sm font-medium hover:bg-red-500/15">
                      😰 Wait 3 days (lose {48}s income)
                    </button>
                  </div>
                )}
                {chapter.mechanicType === 'loan_compare' && (
                  <LoanCompareMechanic
                    config={chapter.mechanicConfig as LoanCompareConfig}
                    onComplete={() => handleMechanicComplete(0)}
                  />
                )}
                {chapter.mechanicType === 'trust_check' && (
                  <TrustCheckMechanic
                    config={chapter.mechanicConfig as TrustCheckConfig}
                    onComplete={(passed) => handleMechanicComplete(passed ? 10 : 0)}
                  />
                )}
                {chapter.mechanicType === 'asset_buy' && (
                  <AssetBuyMechanic
                    config={chapter.mechanicConfig as AssetBuyConfig}
                    onComplete={(units) => {
                      if (units > 0) {
                        buyAsset({
                          name: (chapter.mechanicConfig as AssetBuyConfig).asset,
                          emoji: (chapter.mechanicConfig as AssetBuyConfig).emoji,
                          unitsBought: units,
                          costPerUnit: (chapter.mechanicConfig as AssetBuyConfig).unitCost,
                          totalCost: units * (chapter.mechanicConfig as AssetBuyConfig).unitCost,
                        })
                      }
                      handleMechanicComplete(0)
                    }}
                  />
                )}
                {chapter.mechanicType === 'allocation_wheel' && (
                  <AllocationMechanic
                    config={chapter.mechanicConfig as AllocateConfig}
                    onComplete={() => handleMechanicComplete(0)}
                  />
                )}
                {chapter.mechanicType === 'graduation' && (
                  <GraduationMechanic
                    config={chapter.mechanicConfig as { requirements: Array<{ label: string; chapterId: string; emoji: string }> }}
                    completedChapters={completedChapters}
                    onComplete={() => handleMechanicComplete(0)}
                  />
                )}
              </motion.div>
            )}

            {/* CHOICE */}
            {stage === 'choice' && (
              <motion.div key="choice" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                <div className="mb-4 rounded-xl bg-white/3 border border-line-subtle p-3">
                  <div className="text-[10px] text-amber-400/70 uppercase tracking-widest font-semibold mb-1">
                    📜 The Lesson
                  </div>
                  <p className="text-xs text-white/60 leading-relaxed">{chapter.lesson}</p>
                </div>
                <MissionChoice choices={chapter.choices} onChoose={handleChoice} />
              </motion.div>
            )}

            {/* REFLECTION */}
            {stage === 'reflection' && selectedChoice && (
              <motion.div key="reflection" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                <DailyReflection
                  chapterTitle={chapter.title}
                  chapterNum={chapter.number}
                  choiceMade={selectedChoice}
                  xpEarned={selectedChoice.xpReward + chapter.xpReward}
                  totalXp={xp}
                  totalGold={gold}
                  dayNumber={dayNumber}
                  onContinue={handleReflectionContinue}
                />
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* ── Right sidebar: financial context ── */}
        <aside className="w-64 shrink-0 border-l border-line-subtle bg-[#060910] p-4 space-y-4 overflow-y-auto hidden lg:block">
          <SavingsBuckets gold={gold} savings={savings} emergency={emergency} debt={debt} />
          <Ledger entries={ledger} maxRows={6} showSummary={false} />

          {/* Chapter lesson card */}
          <div className="rounded-xl bg-amber-500/8 border border-amber-500/20 p-3">
            <div className="text-[9px] text-amber-400/60 uppercase tracking-widest font-semibold mb-1.5">
              Core Lesson
            </div>
            <p className="text-xs text-amber-200/70 leading-relaxed">{chapter.lesson}</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
