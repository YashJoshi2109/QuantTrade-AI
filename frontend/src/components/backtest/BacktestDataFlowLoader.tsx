"use client";

import { Player } from "@remotion/player";
import { motion, AnimatePresence } from "framer-motion";
import {
  DataFlowPipes,
  type DataFlowNode,
  type DataFlowEdge,
} from "@/components/ui/data-flow-pipes";
import TickerLogo from "@/components/TickerLogo";
import {
  Activity,
  AlertTriangle,
  RotateCw,
  XCircle,
  CheckCircle2,
} from "lucide-react";

/*
 * Backtest pipeline visualization — shows the real-time data cycle:
 *
 *  [TICKER] Strategy ─┬─→ Market Data ──→ Indicators ──→ Signals
 *                      │                                     │
 *                      └─→ Risk Model ──────────→ Execution ←┘
 *                                                     │
 *                                               Performance
 *
 * States: running (cyan pulses), error (red pulses, frozen), success (green flash)
 */

const BACKTEST_NODES: DataFlowNode[] = [
  { id: "strategy", x: 100, y: 200, label: "Strategy" },
  { id: "market", x: 340, y: 120, label: "Market Data" },
  { id: "risk", x: 340, y: 300, label: "Risk Model" },
  { id: "analysis", x: 560, y: 120, label: "Indicators" },
  { id: "signals", x: 760, y: 120, label: "Signals" },
  { id: "execution", x: 760, y: 300, label: "Execution" },
  { id: "results", x: 960, y: 200, label: "Performance" },
];

const BACKTEST_EDGES: DataFlowEdge[] = [
  { from: "strategy", to: "market", startFrame: 0 },
  { from: "strategy", to: "risk", startFrame: 8 },
  { from: "market", to: "analysis", startFrame: 18 },
  { from: "analysis", to: "signals", startFrame: 32 },
  { from: "signals", to: "execution", startFrame: 46 },
  { from: "risk", to: "execution", startFrame: 40 },
  { from: "execution", to: "results", startFrame: 56 },
];

// Error state: pulses only travel partway then stop
const ERROR_EDGES: DataFlowEdge[] = [
  { from: "strategy", to: "market", startFrame: 0 },
  { from: "strategy", to: "risk", startFrame: 8 },
  { from: "market", to: "analysis", startFrame: 18 },
];

function RunningScene() {
  return (
    <DataFlowPipes
      nodes={BACKTEST_NODES}
      edges={BACKTEST_EDGES}
      pipeColor="#1e293b"
      pulseColor="#06b6d4"
      pulseLength={50}
      pulseDuration={30}
      background="transparent"
      nodeColor="rgba(15, 23, 42, 0.9)"
      textColor="#e2e8f0"
      speed={1.2}
      viewBox="0 0 1060 420"
    />
  );
}

function ErrorScene() {
  return (
    <DataFlowPipes
      nodes={BACKTEST_NODES}
      edges={ERROR_EDGES}
      pipeColor="#1e293b"
      pulseColor="#ef4444"
      pulseLength={40}
      pulseDuration={28}
      background="transparent"
      nodeColor="rgba(15, 23, 42, 0.9)"
      textColor="#64748b"
      speed={0.6}
      viewBox="0 0 1060 420"
    />
  );
}

interface BacktestDataFlowLoaderProps {
  strategyName: string;
  symbol: string;
  monteCarlo?: boolean;
  walkForward?: boolean;
  elapsedSec: number;
  error?: string | null;
  onRetry?: () => void;
  onDismissError?: () => void;
}

export default function BacktestDataFlowLoader({
  strategyName,
  symbol,
  monteCarlo,
  walkForward,
  elapsedSec,
  error,
  onRetry,
  onDismissError,
}: BacktestDataFlowLoaderProps) {
  const hasError = !!error;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex flex-col items-center justify-center h-[600px] bg-[#0a0f1e]/60 backdrop-blur-2xl border border-slate-800/40 rounded-2xl overflow-hidden"
    >
      {/* Ambient glow — shifts red on error */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div
          animate={{
            backgroundColor: hasError
              ? "rgba(239, 68, 68, 0.03)"
              : "rgba(6, 182, 212, 0.04)",
          }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] rounded-full blur-[100px]"
        />
        <div
          className={`absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent ${hasError ? "via-red-500/20" : "via-cyan-500/20"} to-transparent`}
        />
        <div
          className={`absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent ${hasError ? "via-red-500/20" : "via-blue-500/20"} to-transparent`}
        />
      </div>

      {/* Stock logo badge — floats above the pipeline at the Strategy node position */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
        className="relative z-20 flex items-center gap-3 mb-3"
      >
        <div
          className={`relative p-1 rounded-xl ${
            hasError
              ? "bg-red-500/10 border border-red-500/20"
              : "bg-cyan-500/10 border border-cyan-500/20"
          }`}
        >
          <TickerLogo symbol={symbol} size={36} />
          {/* Pulse ring around logo */}
          {!hasError && (
            <motion.div
              className="absolute inset-0 rounded-xl border border-cyan-400/40"
              animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          {hasError && (
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
              <XCircle className="w-3 h-3 text-white" />
            </div>
          )}
        </div>
        <div className="text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-white tracking-tight">
              {symbol.toUpperCase()}
            </span>
            <span
              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md ${
                hasError
                  ? "bg-red-500/15 text-red-400 border border-red-500/25"
                  : "bg-cyan-500/15 text-cyan-400 border border-cyan-500/25"
              }`}
            >
              {hasError ? "Failed" : "Simulating"}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 font-mono mt-0.5">
            {strategyName}
            {monteCarlo ? " · Monte Carlo" : ""}
            {walkForward ? " · Walk-forward" : ""}
          </p>
        </div>
      </motion.div>

      {/* Pipeline animation */}
      <div className="relative w-full max-w-[900px] h-[300px] mx-auto">
        <AnimatePresence mode="wait">
          {hasError ? (
            <motion.div
              key="error-scene"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
            >
              <Player
                component={ErrorScene}
                durationInFrames={70}
                fps={30}
                compositionWidth={1060}
                compositionHeight={420}
                style={{ width: "100%", height: "100%" }}
                controls={false}
                autoPlay
                loop
                clickToPlay={false}
                acknowledgeRemotionLicense
              />
              {/* Error X overlay on the node where it failed */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.5, type: "spring", stiffness: 300 }}
                className="absolute"
                style={{
                  /* Position over the "Indicators" node (4th in chain) ~53% from left, ~28% from top */
                  left: "50%",
                  top: "26%",
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div className="w-10 h-10 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center backdrop-blur-sm">
                  <XCircle className="w-5 h-5 text-red-400" />
                </div>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="running-scene"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
            >
              <Player
                component={RunningScene}
                durationInFrames={90}
                fps={30}
                compositionWidth={1060}
                compositionHeight={420}
                style={{ width: "100%", height: "100%" }}
                controls={false}
                autoPlay
                loop
                clickToPlay={false}
                acknowledgeRemotionLicense
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Status section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="relative text-center z-10"
      >
        <AnimatePresence mode="wait">
          {hasError ? (
            <motion.div
              key="error-status"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex flex-col items-center gap-3"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <p className="text-sm text-red-400 font-bold tracking-tight">
                  Backtest Failed
                </p>
              </div>

              {/* Error message */}
              <div className="max-w-md px-4 py-2.5 bg-red-500/8 border border-red-500/20 rounded-xl">
                <p className="text-xs text-red-300/80 font-mono leading-relaxed">
                  {error}
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 mt-1">
                {onRetry && (
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={onRetry}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 transition-shadow"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    Retry Backtest
                  </motion.button>
                )}
                {onDismissError && (
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={onDismissError}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800/60 border border-slate-700/40 text-slate-400 text-xs font-bold hover:text-slate-300 transition-colors"
                  >
                    Dismiss
                  </motion.button>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="running-status"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <div className="flex items-center justify-center gap-2 mb-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                >
                  <Activity className="w-4 h-4 text-cyan-400" />
                </motion.div>
                <p className="text-sm text-white font-bold tracking-tight">
                  Running Backtest Simulation
                </p>
              </div>

              {/* Progress bar */}
              <div className="mt-2 w-56 mx-auto">
                <div className="h-[3px] bg-slate-800/80 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background:
                        "linear-gradient(90deg, #06b6d4, #3b82f6, #06b6d4)",
                      backgroundSize: "200% 100%",
                    }}
                    initial={{ width: "0%", backgroundPosition: "0% 0%" }}
                    animate={{
                      width: "100%",
                      backgroundPosition: ["0% 0%", "200% 0%"],
                    }}
                    transition={{
                      width: { duration: 120, ease: "linear" },
                      backgroundPosition: {
                        duration: 2,
                        repeat: Infinity,
                        ease: "linear",
                      },
                    }}
                  />
                </div>
              </div>

              <AnimatePresence>
                {elapsedSec > 0 && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[11px] text-slate-600 font-mono mt-2 tabular-nums"
                  >
                    {elapsedSec}s elapsed
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
