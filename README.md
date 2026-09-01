# Aqua Intelligence v3 — NRW Strategy Engine Prototype

Final pre-publish interactive prototype for DMA leakage strategy planning.

## Highlights

- Real Leaflet + OpenStreetMap basemap
- Clickable DMA pipes / subzones
- Pipe-level risk and "Analyse this section"
- Permanent / Lift & Shift / Hybrid / Auto Select
- Intervention Intensity slider
- Demo scenario presets
- Cost posture: Capex Sensitive / Balanced / Maximum Detection
- Pressure, flow, MNF, burst, asset age/material inputs
- Data quality / confidence scoring
- Explainable "Why this recommendation?"
- Manpower and survey-duration estimates
- Technology suitability matrix:
  - acoustic loggers
  - correlator
  - hydrophone
  - pressure logging
  - step testing
  - transient monitoring
  - satellite screening
  - ground microphone
- Field verification gate before excavation
- GeoJSON import for real DMA / pipe GIS
- Save / load scenario using browser localStorage
- Export strategy to JSON
- Methodology / engineering disclaimer modal

## Publish on GitHub Pages

1. Upload `index.html`, `styles.css`, `app.js`, `README.md`.
2. Go to **Settings → Pages**.
3. Choose **Deploy from a branch**.
4. Select `main` and `/root`.

## Map services

The demo uses OpenStreetMap public raster tiles through Leaflet.

For a production utility deployment, replace or augment the basemap / GIS with:
- ArcGIS
- Mapbox
- MapTiler
- MapLibre vector tiles
- GeoServer WMS / WMTS
- utility-hosted GIS
- GeoJSON / vector tiles generated from the utility asset network

## Important

This is a concept prototype, not a validated hydraulic or leakage model.

The scoring model is intentionally transparent and simplified. A production implementation should be calibrated using utility data, confirmed leak / no-leak outcomes, recovered volume, sensor hit-rate, asset condition, hydraulic model outputs, and repair-response performance.


## v4 polish

- Fixed Leaflet tile sizing with explicit map sizing + `invalidateSize()`
- Added demo data population and random scenario generation
- Added editable:
  - DMA properties
  - pipe length
  - target logger spacing
  - average repair cost
- Demo profiles populate realistic fake utility data
- Additional fields participate in scenario export and sensor-count logic


## v5 platform additions

### DMA portfolio
Ranks a sample portfolio of DMAs by risk, MNF ratio, pressure, bursts and recommended strategy.

### Ask the DMA
Interactive engineering Q&A over the current scenario. It explains:
- why a strategy was selected
- what data is concerning
- whether confidence is sufficient
- what field teams should do next

The GitHub demo uses transparent client-side logic. A production version can connect this interface to an LLM and retrieval layer.

### ROI and payback
Editable:
- recoverable leakage
- value of water
- programme cost
- success rate

### Campaign workflow
Generates a field campaign from the current strategy and provides a checklist through verification and outcome capture.

### AI leak noise classification
Upload an audio recording. The browser analyses:
- RMS energy
- crest factor
- zero-crossing behaviour
- approximate spectral centroid
- duration / sample rate

It then produces a prototype leak-likelihood classification and explanation.

This is deliberately labelled as a prototype classifier. A real classifier should be trained/calibrated on labelled sensor recordings and confirmed field outcomes.
