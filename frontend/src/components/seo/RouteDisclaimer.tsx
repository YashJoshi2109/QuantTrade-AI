/**
 * Server-rendered disclaimer for routes whose page body renders only on the
 * client (useSearchParams / viewport gating), so the financial disclaimer is
 * in the initial HTML. Sits below the page; padded to clear the desktop
 * sidebar and the mobile bottom nav.
 */
export default function RouteDisclaimer() {
  return (
    <p className="px-4 pb-28 pt-2 text-center text-[11px] leading-relaxed text-fg-muted md:pb-6 lg:pl-[14rem]">
      Research and educational information only. Not financial advice. Quotes may be delayed; past and backtested
      performance does not guarantee future results.
    </p>
  )
}
