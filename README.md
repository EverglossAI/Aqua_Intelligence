# Aqua Intelligence v2 — NRW Strategy Engine

Interactive GitHub-ready front-end prototype for water-utility DMA leakage strategy planning.

## What changed in v2

- Real web map using **Leaflet + OpenStreetMap**
- Interactive DMA boundary
- Clickable water-main / pipe segments
- Pipe risk visualisation
- Pressure, flow and sensor markers
- Recommended sensor deployment overlay
- Strategy choices:
  - Permanent acoustic sensors
  - Lift & Shift
  - Hybrid
  - Auto Select
- 1–10 strategy aggressiveness control
- Inputs for:
  - DMA pressure
  - minimum night flow
  - inlet flow
  - burst history
  - pipe material
  - pipe age
  - background leakage
  - repair response time
- Explainable engineering decision path
- Strategy suitability scoring
- Pipe-specific recommended action
- Export strategy result as JSON

## Run

Open `index.html` or serve the folder:

```bash
python -m http.server 8080
```

## GitHub Pages

Upload all files to a repository and enable:

**Settings → Pages → Deploy from branch → main / root**

## Actual map services

This prototype uses:

- Leaflet for map interaction
- OpenStreetMap raster tiles for the basemap

No API key is required for this demo.

### Production options

The map layer can later be changed to:

- Mapbox
- MapTiler
- Esri ArcGIS
- GeoServer WMS / WMTS
- Utility-hosted GIS tiles
- Vector tiles via MapLibre
- Custom GeoJSON / shapefile-converted network data

For a real utility deployment, the water network should normally come from the utility's GIS rather than being drawn manually.

## Engineering disclaimer

This is a UX/product prototype, not a validated leakage/hydraulic model.

The scoring logic is intentionally transparent and simplified. A production system should use:

- verified DMA balance data
- hydraulic model outputs where available
- actual asset condition history
- confirmed leak / no-leak outcomes
- sensor performance history
- repair response and recovered-volume data
- utility-specific engineering rules

The product should recommend **where and how to investigate**, not automatically authorize excavation.
