# Aqua Intelligence v7 — Compact App Layout

This version fixes the very long scrolling dashboard from v6.

## What changed

- True application navigation: only one module is visible at a time.
- Default screen is **DMA Strategy**.
- Separate modules:
  - Portfolio
  - DMA Strategy
  - Campaigns
  - AI Leak Noise
  - Data Explorer
  - Reports
  - GIS Layers
- DMA Strategy is now a compact three-column working screen:
  - DMA / asset information
  - interactive GIS
  - strategy planner
- The map receives a resize refresh whenever the Strategy tab is opened.
- Portfolio no longer sits permanently above the strategy screen.
- Campaign and acoustic analysis no longer add dozens of screens of vertical content.

## GitHub Pages

Replace the repository root `index.html` with the v7 file.

The build remains single-file to avoid stale CSS/JS asset caching.

## Prototype

All utility information is simulated and engineering logic is illustrative.
Field verification is required before excavation.
