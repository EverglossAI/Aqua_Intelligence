# Aqua Intelligence — NRW Cockpit V1

This branch is the architectural reset of Aqua Intelligence from a browser-style NRW portal into a desktop-first NRW decision cockpit.

## Product model
Utility → Project → Network → DMA → Asset → Sensor/Meter → Time Series → Event → Investigation → Leak → Repair.

## Implemented in this first cockpit build
- New-project workflow with ZIP SHP / GeoJSON import.
- Layer-aware GIS classification for pipe/eupipe, meter/eumeter, valve, hydrant and regionnet/DMA layers.
- Network navigator and map workspace.
- Telemetry import for CSV/JSON with flow, pressure, meter and acoustic classification.
- Data-confidence and data-health indicators.
- Network event engine for missing evidence / readiness signals.
- DMA planning, water-balance and acoustic-deployment entry points.
- PRV / air-valve engineering advisor entry points.
- Aqua Copilot UI designed for a real LLM tool-calling endpoint at `/api/copilot`.
- Explicit non-LLM fallback that reports evidence instead of pretending keyword rules are neural reasoning.

## Reference GIS
The importer is designed against the uploaded Lambay Island package, which contains layers including `pipe`, `eupipe`, `meter`, `eumeter`, `valve`, `hydrant`, and `regionnet`, plus the uploaded Keelung SHP package.

## Run
Open `cockpit/index.html` from a static server. The root `index.html` on this branch redirects to the cockpit.

## Next engineering increments
1. Project persistence (SQLite/GeoPackage).
2. Tauri desktop shell.
3. Network-topology graph and DMA boundary validation.
4. Time-series store + adapters (CSV, API, MQTT/SCADA).
5. Deterministic NRW calculation tools.
6. Hydraulic profile tools for PRV and air-valve sizing.
7. LLM tool-calling service with auditable evidence references.
8. Leak/repair feedback loop for risk-model training.
