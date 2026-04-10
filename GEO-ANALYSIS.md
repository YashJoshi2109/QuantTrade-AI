# GEO Analysis Report — QuantTrade AI

**URLs Analyzed:** quanttrade.us / www.quanttrade.us
**Date:** 2026-04-10

---

## GEO Health Score: 52/100

| Dimension | Weight | Score | Weighted | Status |
|---|---|---|---|---|
| Citability | 25% | 38 | 9.5/25 | FAIL |
| Structural Readability | 20% | 60 | 12.0/20 | PARTIAL |
| Multi-Modal Content | 15% | 55 | 8.25/15 | PARTIAL |
| Authority & Brand Signals | 20% | 22 | 4.4/20 | CRITICAL |
| Technical Accessibility | 20% | 90 | 18.0/20 | PASS |

## Platform Scores

| Platform | Score | Key Issue |
|---|---|---|
| Google AI Overviews | 35/100 | No E-E-A-T third-party signals |
| ChatGPT | 30/100 | Content CSR-gated, not in training corpus |
| Perplexity | 45/100 | llms.txt helps, but no citable blocks |
| Bing Copilot | 28/100 | Weak backlink profile |
| Claude.ai | 40/100 | llms.txt present, CSR wall limits extraction |

## Critical Findings

### 1. SSR Failure — Most Content Invisible to AI Crawlers
Nearly all pages use `'use client'` — AI crawlers see empty bodies:
- `/about`, `/research`, `/monitor`, `/backtest`, `/markets`, `/ideas-lab`, `/help`, `/legal`
- Only metadata/schema in `<head>` is visible

### 2. Zero Citable Answer Blocks
No 134-167 word self-contained passages on any page. No question-format headings.

### 3. Brand Mention Signals — Critical Gap
- YouTube: NOT PRESENT (strongest AI citation signal, 0.737 correlation)
- Wikipedia: NOT PRESENT
- Reddit: NOT DETECTED
- ProductHunt: NOT DETECTED

### 4. llms.txt Issues
- Says "Next.js 16" (should be 15)
- Missing game module
- No /llms-full.txt

## Top 5 Actions (Priority Order)

1. **Convert /about to SSR** (+12 GEO points) — Makes 800+ words visible to AI crawlers
2. **Create /faq with FAQPage schema** (+10 points) — 7 questions, 134-167 word answers each
3. **Publish YouTube demo video** (+8 points) — Strongest known AI citation signal
4. **Fix llms.txt** (+5 points) — Correct errors, add missing sections
5. **Expand robots.ts sameAs** (+3 points) — Add OAI-SearchBot, ChatGPT-User

## Projected Score After Fixes: ~73/100
