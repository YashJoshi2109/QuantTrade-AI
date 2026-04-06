# UI / UX (product-grade)

Use alongside `.claude/frontend-skills.md` for visual craft and `owasp-security-skills.md` for safe patterns (links, CSP-minded embedding, no escaped user HTML).

## Product context: QuantTrade

- **Dense terminal HUD**: legible at small sizes, monospace for numbers, clear hierarchy (label → value → meta).
- **One accent family**: cyan/sky on slate; avoid rainbow panels; status = color + icon, not color alone.
- **Motion**: subtle; loading states must not flash entire layouts; prefer opacity/height on skeletons.
- **Global Monitor**: widgets are **scannable** (title, primary metric, secondary line); overflow scrolls inside the card, not the page column.
- **About / marketing-adjacent**: editorial typography allowed (serif display + humanist sans), factual tone, no template-y hype (“revolutionize”, “unlock”, “leverage AI”).

## Anti-patterns (reads as generic / “AI”)

- Purple gradient hero on white; Inter-only stacks; emoji bullets in feature grids; symmetric three-column “icon + title + lorem”.
- Unbounded external `href` without `rel="noopener noreferrer"` on user- or API-origin links opened in new tabs.

## Checklist before shipping UI

- [ ] Focus states visible on keyboard nav
- [ ] Touch targets ≥ 44px on mobile where primary
- [ ] `aria-label` on icon-only controls; regions for ticker / stats strips
- [ ] External user-facing links: `rel="noopener noreferrer"` when `target="_blank"`

Remotion applies only to video compositions; do not add Remotion to standard app routes unless explicitly building render pipelines.
