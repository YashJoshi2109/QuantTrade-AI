import BacktestClient from './BacktestClient'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema } from '@/lib/schema'

// Breadcrumb lives on the page (not the layout) so /backtest/classic only
// carries its own trail.
export default function BacktestPage() {
  return (
    <>
      <JsonLd data={breadcrumbSchema([{ name: 'Backtest', path: '/backtest' }])} />
      <BacktestClient />
    </>
  )
}
