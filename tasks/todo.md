# Rebrand Stackly → StackX — todo

Plan: `C:\Users\olcas\.claude\plans\inherited-strolling-quiche.md`

## Checklist
- [x] globals.css tokens (bg/surface/ink/line/lime/success/warning/danger/primary/ring/radius-btn/radius-input)
- [x] layout.tsx fonts (Inter replaces Bricolage+Instrument)
- [x] shared Wordmark component + call sites (sidebar, home-nav, home-footer, mobile-header — found during verification, not in original plan list)
- [x] radius swaps: button.tsx, pill.tsx, cta-link.tsx, input.tsx, select.tsx, saas-combobox.tsx, local input-class constants, + 2 "add" CTA links in vendors/import pages (found during verification)
- [x] status-color migration: pill.tsx, renewal-track.tsx, kpi-cards.tsx, utilization-bar.tsx+seats.ts+seats.test.ts, reconciliation-preview.tsx, stat-card.tsx, renewal-demo.tsx, stray text-red-600, contract-seats.tsx warning hex (found during verification)
- [x] wordmark/lime judgment calls: kicker labels, inline links, locale-switcher active chip + focus ring, user-menu focus ring, cta-link hover, how-it-works.tsx teal chip, features-grid.tsx icon chip + home-hero.tsx eyebrow bg (found during verification)
- [x] naming: messages/es.json + en.json, layout.tsx metadata, email.ts, docs/SPECS.md, CLAUDE.md, docs/DECISIONS.md, delete landing.html, docs/mockups.html historical comment
- [x] verification: lint/typecheck/build pass; test passes except the pre-existing local-Supabase-required suites (expected, see CLAUDE.md); Playwright screenshots of landing (desktop+mobile) and login/signup forms confirm tokens/wordmark/radii/CTA render correctly. Dashboard/vendors/contract-form screenshots BLOCKED — remote Supabase project requires email confirmation to sign up, and hit its email-send rate limit after 2 attempts. Code for those screens was reviewed directly (renewal-track tone classes, kpi-cards, radius) rather than screenshotted.
- [ ] Follow-up: get authenticated screenshots (dashboard renewals track, vendors table, contract form) once an email-confirmed test account is available, or ask user for existing test credentials.
- [ ] Follow-up: after pushing to main, curl a real production route to confirm the deploy renders (per CLAUDE.md deploy note) — not yet pushed.
