import fs from 'node:fs'
import path from 'node:path'

const APP = path.resolve(__dirname, '../../app')
const PUBLIC = path.resolve(__dirname, '../../../public')

/**
 * True when `pathname` resolves to an App Router page or route handler
 * (dynamic [segment] folders match any value) or to a file in public/.
 */
export function routeExists(pathname: string): boolean {
  const clean = pathname.split(/[?#]/)[0]
  if (clean !== '/' && fs.existsSync(path.join(PUBLIC, clean)) && fs.statSync(path.join(PUBLIC, clean)).isFile()) return true
  const segs = clean.split('/').filter(Boolean)
  const walk = (dir: string, i: number): boolean => {
    if (i === segs.length) {
      return ['page.tsx', 'page.ts', 'route.ts'].some((f) => fs.existsSync(path.join(dir, f)))
    }
    if (!fs.existsSync(dir)) return false
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
    const exact = entries.find((e) => e.name === segs[i])
    if (exact && walk(path.join(dir, exact.name), i + 1)) return true
    // sitemap.ts / robots.ts style metadata files
    if (i === segs.length - 1 && /\.(xml|txt)$/.test(segs[i])) {
      const base = segs[i].replace(/\.(xml|txt)$/, '')
      if (fs.existsSync(path.join(dir, `${base}.ts`))) return true
    }
    return entries
      .filter((e) => /^\[[^.\]]+\]$/.test(e.name))
      .some((e) => walk(path.join(dir, e.name), i + 1))
  }
  return walk(APP, 0)
}
