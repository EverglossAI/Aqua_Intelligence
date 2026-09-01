# Aqua Intelligence v13 — Engineer-Controlled GIS Deployment

v13 keeps the v12 Real GIS + Operational Data layout and adds engineer control over the optimiser.

## New engineer GIS modes

### Inspect
Normal click-to-inspect mode.

### Include Point
Marks a valve/hydrant/access point as a preferred candidate.

### Exclude Point
Prevents the optimiser from using the selected GIS point.

### Pin Sensor
Creates an engineer-selected sensor position that the optimiser must retain.

### Not Accessible
Marks a GIS access point as unsuitable for field deployment.

### Prioritise Pipe
Click a pipe to give nearby sensor candidates additional priority.

## Selected-points-only optimisation

Enable:

`Optimise using selected/included points only`

to constrain the optimiser to engineer-approved access locations.

## Coverage view

After optimisation the pipe network is recoloured:

- Green — strong sensor coverage
- Amber — marginal / practical coverage
- Red — under-covered

The right panel reports:

- strong coverage %
- practical coverage %
- priority-pipe coverage %
- average pipe-to-sensor distance

## Manual vs AI

Engineers can pin/include their preferred sensor locations and then click:

`Compare Manual vs AI`

The system compares:

- number of sensors
- overall spatial coverage
- high-risk / priority-pipe coverage

This does not imply the AI plan is automatically better. Field accessibility and engineering judgement can justify a manual override.

## Sensor budget what-if

The plan also evaluates indicative coverage for:

- 10 sensors
- 20 sensors
- 30 sensors
- 40 sensors

This is intended to support budget discussions.

## Existing v12 capabilities retained

- four real GIS datasets
- valves / hydrants / mains
- leak susceptibility zones
- manually positioned pressure loggers
- manually positioned flow meters
- historical leaks and bursts
- CSV / GeoJSON operational data import
- AI zone scoring
- Permanent / Lift & Shift / Hybrid / Auto
- sensor deployment optimisation

## Engineering principle

The intended workflow is:

```text
AI recommendation
        +
GIS evidence
        +
Engineer overrides
        ↓
Final deployment plan
```

The engineer remains in control.
