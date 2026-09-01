# Aqua Intelligence v11 — AI Leak Susceptibility Zones

This version adds GIS-based **AI Leak Susceptibility Zones** to the real GIS sensor-deployment prototype.

## Important terminology

The system does **not** claim that GIS alone can detect an active leak.

The new layer identifies **areas that are more susceptible to leakage / more valuable to survey** based on the available network attributes.

## Inputs used in v11

- pipe material
- inferred pipe age from burial date where available
- pipe diameter
- existing per-pipe risk score
- concentration of high-risk pipes
- density of older mains
- optional average pressure
- optional minimum/night-flow signal

## Output

The application clusters the network spatially and identifies the highest-priority zones.

Each zone receives:
- susceptibility score
- pipe count
- average risk
- average inferred pipe age
- dominant material
- high-risk pipe count
- primary reason for the flag

High-priority zones are shown as translucent magenta/orange circles on the GIS.

Click a zone to inspect why it was flagged.

## Integration with sensor optimisation

If AI susceptibility zones have been calculated before `Optimise Deployment`, candidate valve/hydrant sensor positions inside high-priority zones receive a modest priority boost.

This makes the workflow:

GIS
→ asset susceptibility
→ hotspot zones
→ accessible sensor positions
→ spacing constraints
→ deployment plan

## Production enhancement

The susceptibility model becomes substantially stronger when combined with:
- historical confirmed leaks
- previous burst locations
- minimum-night-flow trend
- pressure history
- pressure transients
- soil / road loading
- pipe joint type
- acoustic logger alarms
- repair outcomes
- leak frequency per km/year

At that point the system can evolve from GIS susceptibility scoring into a calibrated leak-risk model.

## Publish

Replace the GitHub Pages root `index.html` with the v11 file.

The build remains a single-file browser prototype using Leaflet and OpenStreetMap.
