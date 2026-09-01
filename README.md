# Aqua Intelligence v12 — Operational GIS Data

v12 adds positioned operational evidence to the real GIS leak-susceptibility and sensor-deployment prototype.

## New GIS point types

Users can now place directly on the map:

- pressure loggers
- flow meters
- confirmed leak repairs
- bursts

Each point stores location plus relevant values.

### Pressure logger fields

- ID/name
- date
- average pressure
- minimum pressure
- coordinates

### Flow meter fields

- ID/name
- date
- average flow
- minimum night flow
- coordinates

### Failure history

- leak / burst / joint failure / service leak
- date
- confirmed / unconfirmed
- estimated water loss
- coordinates

## Map entry workflow

Choose the point type in the left panel, then click the map.

A form appears for the associated readings.

## Import

Operational data can also be imported as:

- GeoJSON Point features
- CSV

Typical CSV columns:

```text
type,id,lat,lng,date,pressure,min_pressure,flow,mnf,failure_type,loss,confirmed
pressure,PL-01,22.62,120.48,2026-08-20,53,43,,,,,
flow,FM-01,22.61,120.47,2026-08-20,,,42.5,19.2,,,
leak,LR-17,22.60,120.49,2025-11-14,,,,,Leak,95,true
```

## Susceptibility-model improvement

AI Leak Susceptibility Zones now combine:

- pipe material
- inferred pipe age
- diameter
- GIS pipe risk
- clustering of high-risk mains
- confirmed historical failures within 450 m
- nearby pressure logger readings
- nearby minimum-night-flow readings
- optional DMA-level pressure / night-flow values

Historical failures and high local pressure can materially increase a zone's priority score.

## Sensor optimiser improvement

Sensor candidate ranking now also considers:

- proximity to confirmed failures
- high local pressure
- AI susceptibility-zone score

This creates the workflow:

```text
Pipe GIS
+ failure history
+ pressure logger positions
+ flow meter / MNF positions
↓
spatial susceptibility analysis
↓
candidate access points
↓
sensor optimisation
↓
field campaign
```

## Demo data

A **Load Demo Operational Data** button adds sample pressure, flow, leak and burst points to the currently selected GIS area so the interaction can be demonstrated without a telemetry export.

The demo values are explicitly simulated.

## Production direction

A production version should replace manual point readings with time-series ingestion and calculate:

- rolling minimum-night-flow changes
- pressure transients
- pressure/leakage relationships
- burst density per km/year
- repeat-failure clusters
- leak repair recurrence
- change-point detection
- acoustic alarm coincidence

The result would be a continuously updated leakage-risk surface rather than a static risk map.
