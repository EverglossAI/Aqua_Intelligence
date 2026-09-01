# Aqua Intelligence v9 HARDENED

This build fixes the JavaScript crash visible in the v7/v8 screenshots:

`Cannot read properties of null (reading 'addEventListener')`

## Root cause

The tabbed application removed several panels from the DOM, but older JavaScript still referenced controls belonging to those panels. A missing control could stop the entire script before Leaflet initialised.

That is why the map area was blank and no pipes were drawn.

## v9 fix

- Missing optional DOM elements now use a safe inert shim instead of throwing.
- Map startup is isolated from the optional Portfolio / ROI / AI / report modules.
- A failure in a secondary module can no longer prevent GIS startup.
- Leaflet map startup is wrapped independently.
- Repeated map size recalculation remains enabled.
- Coloured pipeline overlays remain visible even if the OpenStreetMap basemap cannot load.
- Interactive Leaflet SVG features explicitly accept pointer events.
- A visible map status label confirms the v9 GIS code is loaded.
- A runtime warning specifically detects if Leaflet zoom controls did not initialise.

There are still 49 references to controls that are intentionally absent from the compact Strategy tab. In v9 these are safely ignored instead of terminating the application.

## Publish

Replace **only `index.html`** in the GitHub repository root.

After GitHub Pages rebuilds, perform:

**Ctrl + Shift + R**

The top prototype banner must say:

**v9 HARDENED**

If it still says v7 or v8, GitHub/browser cache is serving the previous file.

## Expected map behaviour

On DMA Strategy you should see:

- OpenStreetMap basemap (if the tile service is reachable)
- Leaflet +/- zoom buttons
- DMA boundary
- coloured water-main linework
- pressure / flow markers
- clickable pipe sections

Even if OSM tiles are unavailable, the dark grid fallback and coloured mains should remain visible.
