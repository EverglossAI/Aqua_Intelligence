# Aqua Intelligence — NRW Cockpit V3

Aqua Intelligence is being rebuilt from a browser-style NRW portal into a desktop-first NRW decision cockpit.

## Product model
Utility → Project → Network → DMA → Asset → Sensor/Meter → Time Series → Event → Investigation → Leak → Repair.

## V1 foundation
- New project workflow with ZIP SHP / GeoJSON import.
- Layer-aware GIS classification for pipe/eupipe, meter/eumeter, valve, hydrant and regionnet/DMA layers.
- Network navigator and engineering map canvas.
- CSV/JSON telemetry import for flow, customer meter, pressure and acoustic data.
- Data health / confidence and event panels.

## V2 — Network Intelligence
Implemented on `feature/nrw-cockpit`:
- Pipe-topology graph built from actual SHP geometry with endpoint snapping.
- Connectivity diagnostics: nodes, pipe edges, connected components, endpoints and junctions.
- DMA/region validation against contained pipes, valves and meters.
- Water-balance engine using imported system-input and authorized-consumption evidence.
- Flow + pressure + acoustic + asset-risk fusion for leak survey prioritisation.
- 20-hydrophone deployment planner using network risk, acoustic suitability, accessible assets and spacing.
- Browser-local project persistence using IndexedDB.
- Local natural-language tool routing for topology, NRW, leak fusion, sensor deployment, PRV and air-valve requests.

## V3 — Engineering Intelligence
- Network-wide preliminary PRV candidate screening using valve locations plus nearby pressure/flow evidence.
- Air-valve candidate detection from pipe Z/elevation high points when 3D GIS geometry is available.
- Explicit missing-data warnings when hydraulic profile or telemetry is insufficient.
- Engineering guardrails: outputs are preliminary recommendations, not final design approval.

## Engineering inputs still required for final PRV sizing
- Upstream/downstream pressure envelope.
- Minimum, average, peak and fire flow.
- Valve authority / required pressure drop.
- Cavitation check.
- Manufacturer Cv/Kv and valve operating limits.

## Engineering inputs still required for final air-valve sizing
- Longitudinal/elevation profile.
- Filling and draining rates.
- Normal operating flow.
- Allowable differential pressure.
- Vacuum / transient criteria.
- Manufacturer air-flow curves.

## Reference GIS
The importer is designed against the uploaded Lambay Island package, including `pipe`, `eupipe`, `meter`, `eumeter`, `valve`, `hydrant`, and `regionnet`, plus the Keelung SHP package.

## Run
Use a local static server when possible. The root of `feature/nrw-cockpit` redirects to `cockpit/`.

## Next major work
1. Proper Tauri desktop packaging.
2. Unit/time-window mapping UI for telemetry import.
3. Hydraulic solver integration for pressure-zone and PRV scenarios.
4. Better network snapping/topology repair tools.
5. Auditable LLM service with tool-calling and evidence citations.
6. Leak/repair feedback loop for model calibration.
