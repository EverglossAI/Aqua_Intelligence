# Aqua Intelligence v8 — Map Fixed

This build fixes the map initialization failure in v7.

## Root cause

v7 removed several panels while retaining JavaScript event bindings to their controls. The first missing control stopped JavaScript execution before Leaflet `initMap()` ran. As a result there were no Leaflet controls, tiles, GIS overlays or pipelines.

## Fixes

- missing optional UI elements can no longer crash the whole application
- Leaflet map initializes normally
- OpenStreetMap uses the direct tile endpoint
- DMA view automatically fits the network boundary and pipeline geometry
- six simulated water mains are always drawn over the basemap
- pipes are clickable and show asset/risk information directly on the map
- tile-loading failure is reported separately from GIS overlay rendering
- Strategy tab still refreshes Leaflet when reopened

Replace only `index.html` in the GitHub Pages repository.
