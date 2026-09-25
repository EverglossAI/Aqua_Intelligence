# Lambay Island synthetic telemetry demo

**All telemetry in this folder is synthetic demo data, not field measurements.**

Generated from the uploaded Lambay Island GIS. The source contains 8 `regionnet` polygon records across three source folders, but only 4 unique DMA IDs. Demo telemetry therefore uses one logical DMA per unique `unific_id`.

## Assets
- 12 pressure loggers: inlet, mid-zone and distal logger for each logical DMA.
- 4 DMA inlet flow meters: positioned at a high-diameter pipe / DMA boundary crossing candidate.
- 3 days of 15-minute pressure and flow telemetry starting 2026-09-01.

## Files
- `lambay_demo_assets.geojson` — pressure logger and DMA meter positions.
- `lambay_pressure_readings_demo.csv` — 15-minute pressure telemetry in mH2O.
- `lambay_dma_flow_readings_demo.csv` — 15-minute inlet flow telemetry in L/s.
- `lambay_demo_summary.json` — generated summaries and scenario labels.

## Intended demo scenarios
- Baisha: stable pressure profile.
- Danan: distal low-pressure event on day 2 evening.
- Shangshan: lower but relatively stable pressure zone.
- Tianfu: elevated minimum-night-flow signature with recurring morning distal pressure dip.

The anomalies are intentional so Aqua can demonstrate pressure analysis, DMA comparison and leak/operational screening.
