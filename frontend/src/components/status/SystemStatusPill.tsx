"use client";

/**
 * Top-bar status pill: overall state of every probed dependency (replaces the
 * old Finnhub-only "60/60" chip). Desktop: click opens a popover. Mobile
 * (< md): it opens a bottom sheet. Same list component in both.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import { formatAge, pillView, secondsSince } from "@/lib/systemStatus";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import SystemStatusList, {
  StatusDot,
  SystemStatusSkeleton,
} from "./SystemStatusList";
import { useNow, useSystemStatus } from "./SystemStatusProvider";

const PILL_TONE = {
  ok: "border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  degraded:
    "border-amber-500/50 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  down: "border-rose-500/60 bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  unknown:
    "border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
} as const;

function PanelBody({ onNavigate }: { onNavigate?: () => void }) {
  const { data, receivedAt, failed, isLoading } = useSystemStatus();
  const now = useNow(1000);
  const view = pillView(data, failed);
  const updated = data
    ? secondsSince(data.generated_at, data.generated_at, receivedAt, now)
    : null;
  return (
    <>
      <div className="flex items-center gap-2">
        <StatusDot state={view.tone === "unknown" ? "pending" : view.tone} />
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {view.label}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        {data
          ? `Live probe results · updated ${formatAge(updated)} ago${failed ? " · status API not answering, retrying every 10s" : ""}`
          : failed
            ? "The status API is not answering. Retrying every 10s."
            : "Loading the latest probe results…"}
      </p>
      <div className="mt-3">
        {data ? (
          <SystemStatusList status={data} receivedAt={receivedAt} dense />
        ) : isLoading || !failed ? (
          <SystemStatusSkeleton rows={6} />
        ) : null}
      </div>
      <Link
        href="/status"
        onClick={onNavigate}
        className="mt-3 flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        Full status page with latency history{" "}
        <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </>
  );
}

export default function SystemStatusPill({
  className,
}: {
  className?: string;
}) {
  const { data, failed } = useSystemStatus();
  const [open, setOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const ref = useRef<HTMLDivElement>(null);
  const view = pillView(data, failed);

  useEffect(() => {
    if (!open || isMobile) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, isMobile]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`System status: ${view.label}. Open details`}
        title={view.label}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
          "transition-colors hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500",
          PILL_TONE[view.tone],
        )}
        data-testid="system-status-pill"
        data-state={view.tone}
      >
        {view.tone === "unknown" && !data ? (
          <span
            className="h-2.5 w-14 rounded bg-slate-200 dark:bg-slate-700 animate-pulse"
            aria-hidden
          />
        ) : (
          <>
            <StatusDot
              state={view.tone === "unknown" ? "pending" : view.tone}
            />
            <span className="hidden xl:inline">{view.label}</span>
            <span className="xl:hidden">{view.short}</span>
          </>
        )}
      </button>

      {open && !isMobile && (
        <div
          role="dialog"
          aria-label="System status"
          className="absolute right-0 top-[calc(100%+8px)] z-[60] w-[26rem] max-w-[calc(100vw-2rem)] max-h-[min(75vh,40rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              System status
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Close system status"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <PanelBody onNavigate={() => setOpen(false)} />
        </div>
      )}

      {isMobile && (
        <Sheet open={open} onOpenChange={setOpen}>
          {/* globals.css clears backgrounds on `body > div` and `body > div > div`
              (the portal node and its child), so the opaque surface is two levels in. */}
          <SheetContent
            side="bottom"
            className="border-0 bg-transparent p-0 shadow-none [&>button]:hidden"
          >
            <div>
              <div className="max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-white p-4 pb-8 shadow-[0_-12px_40px_rgba(0,0,0,0.35)] dark:border-slate-700 dark:bg-slate-900">
                <div
                  className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600"
                  aria-hidden
                />
                <div className="flex items-center justify-between">
                  <SheetTitle className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    System status
                  </SheetTitle>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    aria-label="Close system status"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <SheetDescription className="sr-only">
                  Live status of every service QuantTrade depends on
                </SheetDescription>
                <div className="mt-2">
                  <PanelBody onNavigate={() => setOpen(false)} />
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
