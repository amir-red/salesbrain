---
name: Zeami
description: Basic visual handoff for matching websites, apps, and dashboards.
colors:
  primary: "#691C47"
  website-paper: "#FCF9FD"
  website-ink: "#432D4C"
  website-muted: "#68566F"
  website-deep: "#6C477D"
  mauve: "#C6ABD7"
  soft: "#EBDFF0"
  line: "#DBCBE2"
  band: "#F6F0F8"
  product-paper: "#FAFAFA"
  product-surface: "#FFFFFF"
  product-ink: "#0F172A"
  product-muted: "#475569"
  product-line: "#E2E8F0"
  obsidian: "#0D0D14"
  dark-card: "#1D1A20"
  dark-line: "#3A2E3C"
  dark-ink: "#E2E8F0"
  dark-muted: "#94A3B8"
  plum: "#D9A6C4"
  success-light: "#047857"
  success-dark: "#10B981"
  warning-light: "#B45309"
  warning-dark: "#F59E0B"
  error: "#ED2027"
typography:
  website-heading:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "-0.045em"
  website-body:
    fontFamily: "Figtree, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.65
  product-body:
    fontFamily: "Poppins, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  website: "0rem"
  input: "0.75rem"
  card: "1rem"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  section: "4rem"
---

# Zeami — brand basics

## Overview

Zeami should feel calm, capable, human, and precise. Plum and ivory, generous space, clear hierarchy, and the supplied wordmark make the family recognizable.

This is a compact handoff for a designer, developer, or LLM building a matching landing page or separate dashboard. The goal is recognizable visual consistency without guessing colors or mixing old concepts. Open **Zeami-visual-reference.html** beside this guide; it contains the actual logo and visual examples, with fonts embedded for offline viewing.

Use **Zeami** in copy. The lowercase **zeami** lettering belongs to the logo. Keep wording plain, warm, and specific; describe useful outcomes instead of AI hype.

## Colors

| Surface | Background / card | Text / secondary text | Action / highlight |
| --- | --- | --- | --- |
| Website | `website-paper` / `product-surface` | `website-ink` / `website-muted` | `website-deep` / `mauve` |
| Light app or dashboard | `product-paper` / `product-surface` | `product-ink` / `product-muted` | `primary` / `mauve` |
| Dark app | `obsidian` / `dark-card` | `dark-ink` / `dark-muted` | `plum` / `mauve` |

Exact values are in the tokens above. Define them once as CSS variables or theme tokens; reference tokens in components.

- Website dividers use `line`; subtle sections use `soft` or `band`. Product dividers use `product-line` or `dark-line`.
- Website primary buttons: `mauve` fill with `website-ink` text. Light product buttons: `primary` fill with white text. Dark product buttons: `plum` fill with `obsidian` text.
- Use deep plum on light surfaces and pale plum on dark surfaces. Never put white text on pale mauve or pale plum; never use pale accents as small text on white.
- Success and warning use their light/dark token pair, plus a text label or icon. Red is for errors/destructive actions; check each background pairing before using it as small text.
- Cyan is a dedicated observing/status signal in the desktop app, not the general brand accent. Preserve existing status meanings when extending that app.

## Typography

| Context | Typeface | Practical scale |
| --- | --- | --- |
| Website headings | Georgia, regular | Hero `clamp(2.15rem, 4.3vw, 3.35rem)`; section `clamp(1.85rem, 3.6vw, 2.7rem)` |
| Website body | Figtree, 400–600 | 17px body; 14–16px supporting text |
| Website labels / IDs | IBM Plex Mono, 400–500 | 12–14px; restrained tracked uppercase labels |
| App / dashboard | Poppins, 400–600 | 32px page title; 20–24px section title; 16px body; 14px table text |
| Product code / IDs | JetBrains Mono | 14px; only for technical content |

Use tabular numerals for metrics and right-align numeric table columns. Keep normal body tracking unchanged. Load the named fonts in the finished site; system fallbacks keep it usable while fonts load. Native desktop extensions should retain their platform's existing font rendering.

## Layout

**Website:** editorial, spacious, and mostly flat. Use a centered container around 75rem, a 1.5rem mobile gutter, clear section breaks, and roughly 3.5–5.75rem section spacing. Prefer square geometry and thin rules. Existing interactive modules may retain their rounded controls.

**App / dashboard:** compact, readable work surfaces. Use a clear navigation rail, a main heading, a small group of useful metrics, and aligned tables or cards. Use 16–24px padding, 24px card gaps, and 32px between major groups. Collapse columns on phones; keep important actions reachable and data labeled.

## Elevation & Depth

Website: flat fills and hairline dividers; avoid decorative glows, heavy shadows, and gradients. Product: restrained card elevation or existing glass panels is appropriate, with solid readable fallbacks. Avoid excessive nested panels.

## Shapes

Website structure is mainly square. Product cards and dialogs use a 16px radius, inputs 12px, and primary buttons a pill radius. Keep geometry consistent within the surface you are extending.

## Components

**Logo:** use the supplied H12 SVG: lowercase lettering with a four-point star above the i. The HTML contains reusable SVG paths and a download link. Default logo fill is `primary` (`#691C47`); use an ivory reverse on a dark background. Preserve the `1069:322` aspect ratio. Use around 26–32px height in headers, with at least 8px clear space. Do not typeset, stretch, crop, outline, animate, or add effects to the logo.

**Controls:** one clear primary action per view; visible labels and focus rings; comfortable touch targets around 44px. Use understated line icons from one set, not emoji.

**States:** data views must include loading feedback, an empty state with a useful CTA, an error with recovery guidance, and success confirmation. Prevent duplicate submissions and preserve entered data after recoverable errors. Respect reduced motion; use brief 150–200ms feedback transitions.

## Do's and Don'ts

- Do use the exact tokens, real logo, and typography for the chosen surface. Start new public pages with the website style; start new data tools with the light product style.
- Do meet WCAG AA: 4.5:1 for normal text, visible keyboard focus, readable labels, and status meaning beyond color.
- Don't blend every theme into one screen, resurrect the old neon/circuit identity, add unrelated colors, or fill the interface with decorative cards.
- Don't invent metrics, customer proof, or capabilities just to fill a layout.

**Copy into an LLM prompt:** “Build this for Zeami using the attached brand basics and HTML reference. Choose the website style for landing pages or light product style for dashboards. Use the exact color tokens, supplied SVG wordmark, specified fonts, consistent spacing, responsive layouts, accessible contrast, and complete loading/empty/error/success states.”

Source basis, 3 October 2026: website `landing/base.css`, `brief-reference/brands.mjs` (v13) and `logos/zeami-h12.svg`; product `docs/standards/DESIGN_SYSTEM.md` and `frontend_robroi/src/styles/theme.css`; desktop `mate/style.py`. This handoff condenses those sources; it does not replace project-specific implementation rules.
