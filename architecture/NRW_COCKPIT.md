# Aqua Intelligence NRW Cockpit — Architecture

## Principle
Aqua Intelligence is not a dashboard. It is an NRW reasoning system with GIS as its primary engineering canvas.

## Core domains
- **Project**: utility, CRS, GIS sources, integrations, users.
- **Network**: pipes, nodes, valves, hydrants, meters, topology.
- **DMA**: boundary, inlet/outlet meters, isolation assets, pressure zone, population/properties.
- **Telemetry**: flow, AMI/customer consumption, pressure, acoustic, transient.
- **Events**: anomalies, suspected leaks, bursts, sensor failures, data-quality incidents.
- **Investigation**: evidence, field survey, correlation, ground confirmation.
- **Intervention**: repair, valve operation, PRV change, air-valve change.
- **Learning**: confirmed outcomes become labelled evidence for future prioritisation.

## Intelligence stack
1. Import/normalize raw sources.
2. Validate units, timestamps, CRS, topology and data quality.
3. Deterministic engineering calculations.
4. Statistical / ML anomaly detection and ranking.
5. LLM planner that turns natural-language requests into calls to approved tools.
6. Evidence-backed explanation with confidence and assumptions.

The LLM never performs final hydraulic sizing from prose alone. It calls engineering tools and shows the assumptions/results.

## Deterministic tools to implement
- Water balance / IWA components.
- Minimum-night-flow decomposition.
- Pressure-leakage sensitivity.
- DMA boundary connectivity and valve isolation checks.
- Sensor placement coverage.
- Pipe failure / leak-priority scoring.
- Flow/pressure/acoustic event fusion.
- PRV preliminary selection using design flow range and pressure envelope.
- Air-valve location and preliminary sizing from longitudinal profile and filling/draining/transient cases.

## Desktop target
Tauri desktop shell with a local project database. GIS/time-series data may remain local; cloud integrations are optional. The frontend can still use web rendering technology internally, but the product behaves as an engineering desktop application rather than a public web portal.
