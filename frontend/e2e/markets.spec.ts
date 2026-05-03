import { test, expect } from '@playwright/test'

test.describe('Markets Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/markets', { waitUntil: 'domcontentloaded' })
  })

  test('page loads without error', async ({ page }) => {
    await expect(page.locator('html')).toBeVisible()
    const title = await page.title()
    expect(title).toMatch(/QuantTrade|Markets/i)
  })

  test('market data sections are present', async ({ page }) => {
    const isMobile = (page.viewportSize()?.width ?? 1280) < 768
    if (isMobile) {
      // Mobile uses MobileMarkets — different structure, just verify page loaded
      await expect(page.locator('html')).toBeVisible()
      return
    }
    // Desktop: at least one major section should be visible
    const sections = [
      page.locator('.hidden.md\\:block').getByText(/market movers|top gainers|sector/i).first(),
      page.locator('.hidden.md\\:block').getByText(/indices|nasdaq|NYSE/i).first(),
    ]
    let found = false
    for (const section of sections) {
      if (await section.isVisible({ timeout: 12_000 }).catch(() => false)) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })
})

test.describe('Research Page', () => {
  test('loads with default symbol', async ({ page }) => {
    await page.goto('/research', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('html')).toBeVisible()
    const title = await page.title()
    expect(title).toMatch(/QuantTrade|Research/i)
  })

  test('symbol search works', async ({ page }) => {
    await page.goto('/research?symbol=AAPL', { waitUntil: 'domcontentloaded' })
    // Should show AAPL data or loading state
    await page.waitForTimeout(2000)
    const content = await page.content()
    expect(content.toLowerCase()).toContain('aapl')
  })
})
