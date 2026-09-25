# Aqua Intelligence — Map-First UX Specification

## Product intent
Aqua Intelligence is an engineering cockpit for water-utility network intelligence. It must feel like a modern GIS/engineering operating system, not a dashboard.

The map is the product. Everything else is a floating tool on top of it.

## Non-negotiable UX
1. Full-viewport map canvas.
2. No permanent left sidebar.
3. No fixed dashboard grid.
4. All major tools open as floating windows.
5. Floating windows are draggable, resizable, minimizable, closable, and focusable.
6. Minimized windows appear in a bottom taskbar/dock and can be restored.
7. Map remains visible and interactive behind windows.
8. Clean, premium dark engineering aesthetic with restrained cyan/blue accents.
9. Desktop-first, but usable on tablet/mobile.
10. Preserve the existing engineering calculations and demo data unless explicitly replaced.

## Visual hierarchy
- Map fills 100vw x 100vh.
- Top-left: compact Aqua Intelligence brand + project/DMA selector.
- Top-center or top-right: global search / command bar: "Ask Aqua or run a command..."
- Top-right: compact map controls, user/system state, layer selector.
- Bottom-center: minimized-window taskbar.
- Bottom-right: map scale / coordinates / optional quick controls.
- Floating windows use glassy dark surfaces, subtle border, 10-14px radius, soft shadow.

## Map modes
Expose at least:
- Engineering / street map
- Satellite
- Terrain / elevation

Layer controls should support:
- Pipe network
- DMA boundaries
- Pressure sensors
- Flow meters
- Acoustic sensors
- Leak-risk overlay
- Elevation
- Imported GIS

## Core floating windows
Implement a reusable window manager. Initial windows:
- Aqua AI / Command
- DMA Planner
- Network / Asset Inspector
- Hydraulic Analysis
- Sensor Deployment
- Leak Risk
- Layers
- Data Import
- Campaign / Survey Planner

Each tool can start as a wrapper around existing controls and logic.

## Window behaviour
- click brings window to front using z-index manager
- draggable by header
- resizable from edges/corner
- minimize removes body from canvas and adds taskbar item
- restore returns previous size/position
- close hides tool but does not destroy app state
- position/size persists in localStorage
- sensible default positions avoid covering the whole map
- viewport constraints prevent windows from becoming unreachable

## Command bar
The global command bar is central to the product.

Examples:
- "Show high-risk CI pipes"
- "Design a DMA around this area"
- "Where should I place hydrophones?"
- "Compare permanent monitoring vs lift-and-shift"
- "Show pressure below 25 m"
- "Explain why this pipe is high risk"

For this milestone, commands may route to deterministic local functions. Do not fake an external AI API.

## Engineering architecture principle
Natural language -> intent router -> deterministic engineering function -> explanation.

AI must not invent hydraulic calculations. EPANET/hydraulic integration will be added behind deterministic services.

## Data/engineering features to preserve
Retain existing:
- DMA selection
- pipe risk score demo
- strategy comparison
- permanent vs lift-and-shift logic
- imported GeoJSON
- acoustic suitability logic
- existing scenario inputs
- campaign/noise demo functionality where present

## Technical direction for current repo
Current app is static HTML/CSS/JS with Leaflet. Do NOT migrate frameworks in this milestone.

Refactor in place:
- index.html: map-first DOM shell + hidden/floating tool windows
- styles.css: full-screen map, window manager, dock, command bar
- app.js: preserve existing model/calculation functions; add UI/window manager and map layer manager

Keep dependencies minimal and Cloudflare-static compatible.

## Map / GIS improvements
- Maintain Leaflet for this milestone.
- Add selectable basemaps.
- Satellite provider must use a legal public tile source or configurable URL; do not embed private tokens.
- Elevation mode can initially be a visual terrain basemap/layer; actual DEM analytics can be added later.
- Existing imported GeoJSON must continue to work.

## Responsive behaviour
Desktop:
- full freeform draggable windows.

Tablet:
- windows still draggable but clamp to viewport.

Mobile:
- floating windows switch to bottom-sheet/full-screen cards.
- taskbar becomes horizontally scrollable tool dock.

## Accessibility / polish
- Escape closes active non-modal tool where appropriate.
- Buttons have title/aria-labels.
- visible focus states.
- avoid tiny text below practical readability.
- transitions <= 180ms.
- no excessive glowing/neon effects.

## Acceptance criteria for UX milestone
- On load, map occupies the full viewport.
- No permanent sidebar or grid dashboard.
- At least 5 floating tools work.
- Windows drag, resize, minimize, restore, close and persist positions.
- Bottom taskbar restores minimized windows.
- Basemap switcher supports street/satellite/terrain.
- Existing DMA map/demo and risk calculations still function.
- GeoJSON import still functions.
- Existing key demo features remain reachable through floating tools.
- No console errors on startup.
- Works as a static deployment on Cloudflare.
