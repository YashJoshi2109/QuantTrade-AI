import { BRAND_INTRO_ATTR, BRAND_INTRO_STORAGE_KEY } from '@/lib/brandIntro'

// Runs during HTML parsing, before the poster below is painted. Mirrors
// shouldShowBrandIntro(): home page, motion allowed, intro not seen yet.
const decideScript = `try{if(location.pathname==='/'&&!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)&&localStorage.getItem('${BRAND_INTRO_STORAGE_KEY}')!=='1')document.documentElement.setAttribute('${BRAND_INTRO_ATTR}','')}catch(e){}`

/**
 * Server-rendered first frame of the brand intro. Hidden by default; the inline
 * script reveals it (via an attribute on <html>) for a first visit to the home
 * page, so the title paints with the HTML instead of waiting for the Remotion
 * player chunk. BrandIntroGate removes the attribute once the player is up (or
 * when the intro is skipped). CSS in globals.css also fades it out on its own
 * after a few seconds, so it can never get stuck if JS fails.
 */
export default function BrandIntroPoster() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: decideScript }} />
      <div className="brand-intro-poster" aria-hidden="true">
        <div className="brand-intro-poster__title">QuantTrade AI</div>
      </div>
    </>
  )
}
