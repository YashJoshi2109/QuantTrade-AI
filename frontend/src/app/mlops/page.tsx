'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Activity, Brain, Database, AlertTriangle, BarChart3, RefreshCw, ChevronRight, Cpu, Layers } from 'lucide-react'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

interface MLOpsOverview {
  models: { registered: number; production: Record<string, any> }
  experiments: { total_runs: number }
  feature_store: { symbols: number; schema_version: string }
  predictions: Record<string, any>
  alerts: number
}

export default function MLOpsDashboard() {
  const [overview, setOverview] = useState<MLOpsOverview | null>(null)
  const [experiments, setExperiments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    Promise.all([
      fetch(`${API_URL}/api/v1/mlops/overview`, { credentials: 'include', signal: controller.signal }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API_URL}/api/v1/mlops/experiments?limit=10`, { credentials: 'include', signal: controller.signal }).then(r => r.ok ? r.json() : { experiments: [] }).catch(() => ({ experiments: [] })),
    ]).then(([ov, exp]) => {
      setOverview(ov)
      setExperiments(exp.experiments || [])
    }).finally(() => { clearTimeout(timeout); setLoading(false) })
    return () => { controller.abort(); clearTimeout(timeout) }
  }, [])

  const triggerPipeline = async () => {
    setRefreshing(true)
    try {
      await fetch(`${API_URL}/api/v1/mlops/pipeline/run?force=true`, { method: 'POST', credentials: 'include' })
    } catch {}
    setRefreshing(false)
  }

  if (loading) return (
    <AppLayout>
    <div className="min-h-screen flex items-center justify-center">
      <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
    </div>
    </AppLayout>
  )

  const prodModels = overview?.models.production || {}

  return (
    <AppLayout>
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
              <Brain className="w-7 h-7 text-purple-400" />
              MLOps Dashboard
            </h1>
            <p className="text-sm text-slate-500 mt-1">Model lifecycle, monitoring, and pipeline control</p>
          </div>
          <button
            onClick={triggerPipeline}
            disabled={refreshing}
            className="px-4 py-2 bg-purple-500 hover:bg-purple-400 disabled:opacity-40 text-white rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Running...' : 'Run Pipeline'}
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {[
            { label: 'Models', value: overview?.models.registered || 0, icon: Layers, color: 'text-purple-400' },
            { label: 'Production', value: Object.keys(prodModels).length, icon: Cpu, color: 'text-emerald-400' },
            { label: 'Experiments', value: overview?.experiments.total_runs || 0, icon: BarChart3, color: 'text-blue-400' },
            { label: 'Feature Store', value: `${overview?.feature_store.symbols || 0} sym`, icon: Database, color: 'text-cyan-400' },
            { label: 'Alerts', value: overview?.alerts || 0, icon: AlertTriangle, color: overview?.alerts ? 'text-red-400' : 'text-slate-500' },
          ].map((stat) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
                <span className="text-xs text-slate-500 uppercase tracking-wider">{stat.label}</span>
              </div>
              <div className="text-2xl font-bold text-slate-100">{stat.value}</div>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Production Models */}
          <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-6">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-400" /> Production Models
            </h2>
            {Object.keys(prodModels).length === 0 ? (
              <p className="text-sm text-slate-500">No models in production</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(prodModels).map(([name, info]: [string, any]) => (
                  <div key={name} className="p-3 bg-slate-800/30 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-200">{name}</span>
                      <span className="text-xs px-2 py-0.5 bg-emerald-500/15 text-emerald-400 rounded-full">v{info.version}</span>
                    </div>
                    {info.metrics && (
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        {Object.entries(info.metrics).slice(0, 3).map(([k, v]: [string, any]) => (
                          <div key={k}>
                            <div className="text-slate-500">{k.replace(/_/g, ' ')}</div>
                            <div className="text-slate-300 font-mono">{typeof v === 'number' ? v.toFixed(4) : v}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Experiments */}
          <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-6">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-400" /> Recent Experiments
            </h2>
            {experiments.length === 0 ? (
              <p className="text-sm text-slate-500">No experiments recorded yet</p>
            ) : (
              <div className="space-y-2">
                {experiments.slice(0, 8).map((exp: any) => (
                  <div key={exp.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.03] transition-colors">
                    <div className={`w-2 h-2 rounded-full ${
                      exp.status === 'completed' ? 'bg-emerald-400' :
                      exp.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-300 truncate">{exp.name}</div>
                      <div className="text-[10px] text-slate-500">{exp.created_at?.split('T')[0]}</div>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      exp.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' :
                      exp.status === 'failed' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'
                    }`}>
                      {exp.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Feature Store */}
          <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-6">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Database className="w-4 h-4 text-cyan-400" /> Feature Store
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>Schema Version</span>
                <span className="font-mono text-slate-300">{overview?.feature_store.schema_version || 'N/A'}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Symbols Stored</span>
                <span className="text-slate-300">{overview?.feature_store.symbols || 0}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Features per Symbol</span>
                <span className="text-slate-300">20</span>
              </div>
            </div>
          </div>

          {/* Pipeline Status */}
          <div className="bg-[#0D1117] border border-white/[0.06] rounded-xl p-6">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-400" /> Pipeline Stages
            </h2>
            <div className="space-y-2">
              {['Data Fetch', 'Feature Computation', 'Data Validation', 'Drift Detection', 'Model Training', 'Evaluation', 'Registration', 'Promotion'].map((stage, i) => (
                <div key={stage} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] text-slate-400 font-bold">
                    {i + 1}
                  </div>
                  <span className="text-sm text-slate-400">{stage}</span>
                  <ChevronRight className="w-3 h-3 text-slate-700 ml-auto" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
    </AppLayout>
  )
}
