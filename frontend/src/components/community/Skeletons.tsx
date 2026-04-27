'use client'

// ── Shimmer Utility ───────────────────────────────────────────────
// All skeletons use Tailwind's animate-pulse. The shimmer block wraps
// with a gradient overlay for premium feel.

function Shimmer({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded bg-surface-raised/60 animate-pulse ${className}`}
    />
  )
}

// ── PostCard Skeleton ─────────────────────────────────────────────

export function PostCardSkeleton() {
  return (
    <div className="bg-surface-base border border-line-subtle rounded-xl p-3 sm:p-4">
      <div className="flex gap-2 sm:gap-3">
        {/* Vote column */}
        <div className="flex flex-col items-center gap-1.5 pt-1 min-w-[36px]">
          <Shimmer className="w-5 h-5 rounded" />
          <Shimmer className="w-6 h-4 rounded" />
          <Shimmer className="w-5 h-5 rounded" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-2.5">
          {/* Meta line */}
          <div className="flex items-center gap-2">
            <Shimmer className="w-20 h-3 rounded" />
            <Shimmer className="w-16 h-3 rounded" />
            <Shimmer className="w-12 h-3 rounded" />
          </div>
          {/* Title */}
          <Shimmer className="w-3/4 h-5 rounded" />
          {/* Body */}
          <Shimmer className="w-full h-4 rounded" />
          <Shimmer className="w-2/3 h-4 rounded" />
          {/* Chips */}
          <div className="flex gap-2">
            <Shimmer className="w-14 h-5 rounded-md" />
            <Shimmer className="w-14 h-5 rounded-md" />
          </div>
          {/* Action bar */}
          <div className="flex gap-4 pt-1">
            <Shimmer className="w-20 h-4 rounded" />
            <Shimmer className="w-14 h-4 rounded" />
            <Shimmer className="w-12 h-4 rounded" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Comment Skeleton ──────────────────────────────────────────────

export function CommentSkeleton({ depth = 0 }: { depth?: number }) {
  return (
    <div className={depth > 0 ? 'ml-3 md:ml-6 border-l-2 border-line-subtle pl-4' : ''}>
      <div className="py-2.5 space-y-2">
        {/* Author line */}
        <div className="flex items-center gap-2">
          <Shimmer className="w-5 h-5 rounded-full" />
          <Shimmer className="w-24 h-3 rounded" />
          <Shimmer className="w-12 h-3 rounded" />
        </div>
        {/* Body */}
        <Shimmer className="w-full h-4 rounded" />
        <Shimmer className="w-4/5 h-4 rounded" />
        {/* Actions */}
        <div className="flex items-center gap-3">
          <Shimmer className="w-16 h-3.5 rounded" />
          <Shimmer className="w-12 h-3.5 rounded" />
        </div>
      </div>
    </div>
  )
}

// ── Community Card Skeleton ───────────────────────────────────────

export function CommunitySkeleton() {
  return (
    <div className="bg-surface-base border border-line-subtle rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Shimmer className="w-10 h-10 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <Shimmer className="w-28 h-4 rounded" />
          <Shimmer className="w-20 h-3 rounded" />
        </div>
      </div>
      <Shimmer className="w-full h-3 rounded" />
      <Shimmer className="w-3/4 h-3 rounded" />
      <div className="flex justify-between items-center pt-1">
        <Shimmer className="w-24 h-3 rounded" />
        <Shimmer className="w-16 h-7 rounded-lg" />
      </div>
    </div>
  )
}

// ── Notification Skeleton ─────────────────────────────────────────

export function NotificationSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-line-subtle">
      <Shimmer className="w-8 h-8 rounded-full shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Shimmer className="w-3/4 h-3.5 rounded" />
        <Shimmer className="w-1/2 h-3 rounded" />
        <Shimmer className="w-16 h-2.5 rounded" />
      </div>
      <Shimmer className="w-2 h-2 rounded-full shrink-0 mt-2" />
    </div>
  )
}

// ── Feed Skeleton (multiple PostCards) ─────────────────────────────

export function FeedSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <PostCardSkeleton key={i} />
      ))}
    </div>
  )
}
