# Aqua Intelligence NRW Cockpit

The active application is the static, framework-free cockpit in `cockpit/`. The repository-root `index.html` redirects there so the repository root remains the Cloudflare/static-host deployment target.

## Run locally

```powershell
python -m http.server 8000
```

Open `http://localhost:8000/`.

## Application structure

- `cockpit/index.html`: active NRW cockpit markup and engineering workbenches.
- `cockpit/app.js`: GIS import, projects, telemetry, NRW analysis, topology, DMA, risk, and deterministic command routing.
- `cockpit/v4.js`: GIS-to-EPANET hydraulics and acoustic planning/analysis.
- `cockpit/styles.css`: cockpit controls and engineering-result styling.
- `aqua-shell.js`: persistent floating-window manager, command bar, taskbar, and basemap management.
- `aqua-shell.css`: full-screen map-first shell and responsive window presentation.

The legacy root `app.js` and `styles.css` are retained as prototype history; they are not the deployed application entry point.