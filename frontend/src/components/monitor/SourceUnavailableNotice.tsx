import { CloudOff } from 'lucide-react'

interface SourceUnavailableNoticeProps {
  title?: string
  detail: string
  compact?: boolean
}

/** Explicit "source unavailable" state, shown instead of zeros or an empty list. */
export default function SourceUnavailableNotice({
  title = 'Source unavailable',
  detail,
  compact = false,
}: SourceUnavailableNoticeProps) {
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 text-left ${
        compact ? 'px-3 py-2' : 'px-4 py-3'
      }`}
    >
      <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-amber-300">{title}</p>
        <p className="text-[10px] leading-relaxed text-fg-muted">{detail}</p>
      </div>
    </div>
  )
}
