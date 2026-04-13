"use client"

import React, { useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { Separator } from "@/components/ui/separator"
import { Flame, TrendingUp, TrendingDown, ExternalLink } from "lucide-react"

interface PredictionMarketCardProps {
  question: string
  outcomes?: { name: string; price: number }[]
  yesPrice?: number | null
  noPrice?: number | null
  volume?: string
  slug?: string
  category?: string
  enableAnimations?: boolean
  delay?: number
}

export function PredictionMarketCard({
  question,
  outcomes = [],
  yesPrice,
  noPrice,
  volume,
  slug,
  category,
  enableAnimations = true,
  delay = 0,
}: PredictionMarketCardProps) {
  const shouldReduceMotion = useReducedMotion()
  const shouldAnimate = enableAnimations && !shouldReduceMotion

  const isBinary =
    outcomes.length === 2 &&
    outcomes.some((o) => o.name.toLowerCase() === "yes")

  const yesOutcome = outcomes.find((o) => o.name.toLowerCase() === "yes")
  const noOutcome = outcomes.find((o) => o.name.toLowerCase() === "no")

  const yesPct = yesOutcome
    ? Math.round(yesOutcome.price * 100)
    : yesPrice != null
      ? Math.round(yesPrice * 100)
      : null
  const noPct = noOutcome
    ? Math.round(noOutcome.price * 100)
    : noPrice != null
      ? Math.round(noPrice * 100)
      : null

  const progressValue = yesPct != null && noPct != null
    ? yesPct / (yesPct + noPct) * 100
    : yesPct != null
      ? yesPct
      : 50

  const topOutcome = yesPct != null && yesPct >= 50 ? "yes" : "no"

  const containerVariants = {
    hidden: { opacity: 0, y: 14, scale: 0.97, filter: "blur(3px)" },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      filter: "blur(0px)",
      transition: {
        type: "spring" as const,
        stiffness: 320,
        damping: 30,
        mass: 0.7,
        delay,
        staggerChildren: 0.06,
        delayChildren: delay + 0.08,
      },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, x: -10, scale: 0.97 },
    visible: {
      opacity: 1,
      x: 0,
      scale: 1,
      transition: { type: "spring" as const, stiffness: 400, damping: 28, mass: 0.5 },
    },
  }

  const barVariants = {
    hidden: { scaleX: 0, opacity: 0 },
    visible: {
      scaleX: 1,
      opacity: 1,
      transition: { type: "spring" as const, stiffness: 300, damping: 30, delay: delay + 0.3 },
    },
  }

  return (
    <motion.div
      className="w-full bg-slate-950/80 border border-slate-800/60 rounded-xl overflow-hidden hover:border-slate-700/70 transition-colors duration-300"
      initial={shouldAnimate ? "hidden" : "visible"}
      animate="visible"
      variants={shouldAnimate ? containerVariants : {}}
    >
      <div className="p-3 space-y-2.5">
        {/* Header badges */}
        <motion.div
          className="flex items-center justify-between"
          variants={shouldAnimate ? itemVariants : {}}
        >
          <div className="flex items-center gap-1.5">
            {topOutcome === "yes" && yesPct != null && yesPct >= 70 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-orange-500/20 border border-orange-500/30 text-[8px] font-bold text-orange-400 uppercase tracking-wider">
                <Flame className="w-2.5 h-2.5" /> Hot
              </span>
            )}
            {category && (
              <span className="px-1.5 py-0.5 rounded bg-slate-700/50 text-[8px] font-bold text-slate-400 uppercase tracking-wider">
                {category}
              </span>
            )}
          </div>
          {slug && (
            <a
              href={`https://polymarket.com/event/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-600 hover:text-sky-400 transition-colors"
              title="View on Polymarket"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </motion.div>

        {/* Question */}
        <motion.div variants={shouldAnimate ? itemVariants : {}}>
          <h4 className="text-[11px] font-semibold text-slate-200 leading-snug line-clamp-2">
            {question}
          </h4>
        </motion.div>

        <motion.div variants={shouldAnimate ? itemVariants : {}}>
          <Separator className="bg-gradient-to-r from-transparent via-slate-700/50 to-transparent" />
        </motion.div>

        {/* Outcome display */}
        {isBinary || (yesPct != null && noPct != null) ? (
          <>
            {/* Binary yes/no voting display */}
            <motion.div className="space-y-1.5" variants={shouldAnimate ? itemVariants : {}}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <TrendingDown className="w-3 h-3 text-rose-400" />
                  <span className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">No</span>
                  <span className="text-sm font-black font-mono text-rose-400">
                    {noPct ?? 0}%
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-black font-mono text-emerald-400">
                    {yesPct ?? 0}%
                  </span>
                  <span className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">Yes</span>
                  <TrendingUp className="w-3 h-3 text-emerald-400" />
                </div>
              </div>

              {/* Progress bar */}
              <motion.div
                className="relative h-2.5 bg-rose-500/40 rounded-full overflow-hidden"
                variants={shouldAnimate ? barVariants : {}}
                style={{ originX: 0 }}
              >
                <div
                  className="absolute inset-y-0 left-0 h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${progressValue}%` }}
                />
                <div
                  className="absolute top-0 h-full w-[3px] bg-slate-950 rounded-full"
                  style={{ left: `${progressValue}%`, transform: "translateX(-50%)" }}
                />
              </motion.div>
            </motion.div>
          </>
        ) : outcomes.length > 0 ? (
          /* Multi-outcome display */
          <motion.div className="space-y-1" variants={shouldAnimate ? itemVariants : {}}>
            {outcomes.slice(0, 4).map((o, i) => {
              const pct = Math.round(o.price * 100)
              const barColors = [
                "from-sky-600 to-sky-400",
                "from-violet-600 to-violet-400",
                "from-amber-600 to-amber-400",
                "from-emerald-600 to-emerald-400",
              ]
              return (
                <div key={i} className="relative h-5 rounded bg-slate-800/60 overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 rounded bg-gradient-to-r ${barColors[i] ?? "from-slate-600 to-slate-500"} transition-all duration-500 opacity-50`}
                    style={{ width: `${Math.max(pct, 3)}%` }}
                  />
                  <div className="absolute inset-0 flex items-center justify-between px-2">
                    <span className="text-[9px] font-medium text-slate-200 truncate max-w-[65%] z-10">
                      {o.name}
                    </span>
                    <span className="text-[9px] font-bold font-mono text-slate-200 z-10">
                      {pct}%
                    </span>
                  </div>
                </div>
              )
            })}
            {outcomes.length > 4 && (
              <span className="text-[8px] text-slate-600 pl-1">
                +{outcomes.length - 4} more
              </span>
            )}
          </motion.div>
        ) : null}

        {/* Volume footer */}
        {volume && volume !== "—" && (
          <motion.div
            className="flex items-center justify-end pt-0.5"
            variants={shouldAnimate ? itemVariants : {}}
          >
            <span className="text-[9px] text-slate-600 font-mono">
              Vol: {volume}
            </span>
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}
