# Aqua Intelligence v10 — Real GIS Sensor Deployment Optimiser

This version replaces the invented demo pipe network with geometry extracted from the four GIS packages supplied for the prototype.

## Included source datasets

- Lambay Island
- Keelung
- Changhua
- Pingtung

The application embeds pipe geometry and available access assets (valves / hydrants / meters where present) directly into the single-file GitHub Pages build.

## What the planner does

1. Select a utility area.
2. Display the real GIS pipe network.
3. Colour pipe segments using an illustrative risk score.
4. Inspect individual pipe attributes.
5. Select Permanent / Lift & Shift / Hybrid / Auto.
6. Set available sensors, target spacing and intervention intensity.
7. Optionally add pressure and night-flow information.
8. Optimise sensor deployment.
9. Rank candidate valve/hydrant access positions.
10. Plot recommended fixed sensors or campaign rounds.

## Current sensor scoring

Candidate points are ranked from:
- nearby pipe risk
- pipe material / age proxy
- acoustic suitability
- pipe diameter
- access asset type
- optional pressure / night-flow signals

This is a prototype rule engine, not a validated optimisation model.

## GIS handling

Projected Taiwan TWD97 / TM2-121 geometry is converted to WGS84 for Leaflet display.
Pingtung layers supplied in WGS84 are used directly.

## Production next steps

A production deployment planner should add:
- graph topology / network connectivity
- true shortest-path / coverage calculations
- hydraulic zones
- DMA boundaries
- valve operability
- accessibility / road constraints
- historical confirmed leak locations
- logger signal history
- pressure-dependent acoustic range
- sensor model-specific spacing rules
- optimisation objectives (max coverage, max risk reduction, fixed sensor budget)
- campaign sequencing and route planning

## Publish

Replace the GitHub Pages root `index.html` with this file.

The app remains a single-file prototype; Leaflet and OpenStreetMap tiles are loaded online.
