# GitHub Copilot instructions — Aqua Intelligence

Always read `AQUA_UX_SPEC.md` before making UI changes.

## Current milestone
Transform the existing dashboard into the map-first floating-window interface defined in the UX spec without rewriting the engineering logic.

## Coding rules
- Keep this milestone framework-free: plain HTML, CSS and JavaScript.
- Preserve Leaflet and existing engineering/demo functions.
- Prefer extraction/reuse over deleting working logic.
- Do not introduce build tooling unless strictly necessary.
- Do not add secrets or API tokens.
- Keep Cloudflare static hosting compatibility.
- Avoid giant rewrites of index.html if a smaller structural edit works.
- Maintain graceful fallback if an optional DOM element is absent.
- Do not allow one missing optional control to stop map startup.

## Architecture
Build these UI primitives first:
1. full-screen map shell
2. WindowManager class/module
3. floating tool-window markup
4. taskbar/dock
5. global command bar
6. basemap/layer switcher

WindowManager requirements:
- registerWindow(id, options)
- open/focus
- drag
- resize
- minimize
- restore
- close
- localStorage persistence
- z-index stacking
- viewport clamping

## Preserve these behaviours
- initMap / DMA rendering
- risk scoring / scenario functions
- selected-pipe inspection
- GeoJSON import
- strategy selection
- analysis outputs
- acoustic/noise demo logic if present

## Refactor strategy
Move the existing dashboard controls into floating tool bodies rather than deleting them.
Map-related popups remain Leaflet popups.
Do not duplicate state unnecessarily.

## Quality gate
Before considering the milestone complete:
- load page with zero console errors
- test DMA switch
- test pipe click
- test analysis controls
- test GeoJSON import
- test basemap switch
- test drag/minimize/restore/close for multiple windows
- refresh and confirm persisted positions
- test 1440x900 and narrow mobile viewport

When unsure, prefer the UX spec over legacy layout.
