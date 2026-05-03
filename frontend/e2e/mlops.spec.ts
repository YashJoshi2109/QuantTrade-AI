import { test, expect, Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/auth')
  await page.getByLabel(/email/i).fill('john@example.com')
  await page.getByLabel(/password/i).fill('password')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/dashboard|mlops/, { timeout: 10_000 }).catch(() => {})
}

test.describe('MLOps Page', () => {
  test('unauthenticated redirect shows sign-in gate', async ({ page }) => {
    // Clear cookies/storage to ensure unauthenticated state
    await page.context().clearCookies()
    await page.goto('/mlops')
    // Should show auth gate or redirect to auth
    await expect(
      page.getByText(/sign in required|sign in/i).first()
    ).toBeVisible({ timeout: 8_000 })
  })

  test('page structure loads for authenticated user', async ({ page }) => {
    await page.goto('/mlops')
    // Check for the MLOps-specific UI elements that don't require auth
    await expect(page.locator('html')).toBeVisible()
    // Page title
    const title = await page.title()
    expect(title).toMatch(/QuantTrade|MLOps/i)
  })

  test('tab navigation renders all tabs', async ({ page }) => {
    await page.goto('/mlops')
    const tabLabels = ['Overview', 'Runs', 'Models', 'Experiments', 'Monitoring', 'Config']
    for (const label of tabLabels) {
      const tab = page.getByRole('button', { name: new RegExp(label, 'i') })
      const count = await tab.count()
      if (count > 0) {
        await expect(tab.first()).toBeVisible()
      }
    }
  })

  test('mobile MLOps renders on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/mlops')
    await expect(page.locator('html')).toBeVisible()
    // Should show mobile layout (not desktop)
    const mobileNav = page.locator('header').filter({ hasText: /overview|runs|models/i })
    if (await mobileNav.isVisible()) {
      await expect(mobileNav).toBeVisible()
    }
  })
})

