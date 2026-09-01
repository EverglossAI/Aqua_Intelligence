# Aqua Intelligence v14 — DOM Fixed

This build fixes the v13 startup crash.

## Root cause
The operational-data modal was rendered after the application script, while the script tried to attach event listeners to `opsClose`, `opsSave`, and related controls immediately. Those elements did not exist yet, causing `Cannot read properties of null (reading addEventListener)` and stopping Leaflet/GIS startup.

## Fix
- Moved the operational modal before the application scripts.
- Wrapped UI event binding in `bindUI()` and run it on `window.load`.
- Added a defensive inert-element fallback so an optional future control cannot kill map startup.
- Retains all v13 engineer-control features.

Publish by replacing the root `index.html`.
