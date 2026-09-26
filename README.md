# Aqua Intelligence NRW Cockpit

The active application is the static, framework-free cockpit in `cockpit/`. The repository-root `index.html` redirects there so the repository root remains the Cloudflare/static-host deployment target.

## Run locally

```powershell
python -m http.server 8000
```

Open `http://localhost:8000/`. Use `npx wrangler dev` when testing the Worker API and static-assets integration.

Elevation profiles can use the Mapbox Terrain provider when the Worker has a `MAPBOX_ACCESS_TOKEN` secret. Configure production with `npx wrangler secret put MAPBOX_ACCESS_TOKEN`; for local Wrangler testing, provide the same binding through a gitignored `.dev.vars` file. The token remains server-side, and the cockpit retains its unavailable state when the binding or upstream service is unavailable.

## Application structure

- `cockpit/index.html`: active NRW cockpit markup and engineering workbenches.
- `cockpit/app.js`: GIS import, projects, telemetry, NRW analysis, topology, DMA, risk, and deterministic command routing.
- `cockpit/cloud-projects.js`: same-origin project API client and revision handling.
- `cockpit/elevation-providers.js`: browser-side elevation provider registry and profile cache.
- `cockpit/lambay-acoustics.js`: imported Lambay sensor/couple/alert layers, linked selection, and deterministic operational summaries.
- `cockpit/v4.js`: GIS-to-EPANET hydraulics and acoustic planning/analysis.
- `cockpit/styles.css`: cockpit controls and engineering-result styling.
- `aqua-shell.js`: persistent floating-window manager, command bar, taskbar, and basemap management.
- `aqua-shell.css`: full-screen map-first shell and responsive window presentation.
- `worker/index.js`: Cloudflare Worker entrypoint and static-assets fallback.
- `worker/routes/elevation.js`: bounded, cached Mapbox Terrain elevation proxy.
- `worker/routes/projects.js`: D1/R2 project API routing and handlers.
- `worker/lib/projects.js`: shared persistence, authorization, and serialization helpers.
- `migrations/`: D1 schema migrations.

Project persistence is cloud-first: D1 owns the project index/state, R2 owns source and normalized payloads, and IndexedDB is a revisioned local cache. See [architecture/PROJECT_PERSISTENCE.md](architecture/PROJECT_PERSISTENCE.md).

## Lambay acoustic operations

The normalized operational artifact is `projects/lambay-island/acoustic/lambay-acoustic-operational-data.json`. It is generated from the three dated EMS workbooks by spatially selecting records against Lambay's pipe extent and then applying material- and couple-path-aware GIS matching. This data is separate from the synthetic pressure/flow telemetry and is never used for hydraulic calibration.

To regenerate and optionally upload the normalized entities plus all three original workbooks:

```powershell
node scripts/import-lambay-acoustics.mjs `
	--project .\lambay-project.json `
	--sensors "$HOME\Downloads\TW_EMS_Taiwan_sensors_report_20260926.xlsx" `
	--couples "$HOME\Downloads\TW_EMS_Taiwan_couples_report_20260926.xlsx" `
	--alerts "$HOME\Downloads\TW_EMS_Taiwan_alerts_report_20260926.xlsx" `
	--output projects\lambay-island\acoustic\lambay-acoustic-operational-data.json `
	--origin http://127.0.0.1:8787
```

Omit `--origin` to generate and validate locally without changing central persistence. The uploader requires project write access, writes normalized sensor/couple/alert indexes to D1, and stores the original XLSX files and normalized JSON as versioned R2 artifacts.

The legacy root `app.js` and `styles.css` are retained as prototype history; they are not the deployed application entry point.