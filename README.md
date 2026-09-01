# Aqua Intelligence

**Interactive NRW Decision Platform for Water Utilities**

Aqua Intelligence is a browser-based prototype for helping water-utility engineers prioritise DMAs, choose leak-detection strategies, assess network risk, plan field campaigns, review acoustic evidence, and explain why a particular intervention is recommended.

This repository is an **interactive concept prototype**. It uses demo data and simplified engineering logic to demonstrate the product workflow.

> **Important:** Aqua Intelligence does not automatically authorise excavation or replace engineering judgement. Leak indications must be field-verified using appropriate methods such as correlation, ground listening, step testing, pressure analysis, or other utility-approved procedures.

---

## Live Demo

This project is designed to run directly on **GitHub Pages**.

The current build is intentionally packaged as a **single `index.html` file** to avoid browser or GitHub Pages cache mismatches between HTML, CSS, and JavaScript versions.

---

# What Aqua Intelligence Demonstrates

The core idea is not simply to display water-network data.

The platform is intended to answer:

> **Which DMA should we investigate first, what strategy should we use, where should we deploy resources, how aggressive should the intervention be, and why?**

The workflow combines:

- DMA performance
- minimum night flow
- inlet flow
- pressure
- pipe material and age
- burst history
- background leakage
- repair response time
- GIS / asset information
- data quality
- acoustic suitability
- intervention intensity
- available budget / cost posture

The system then generates an explainable recommendation.

---

# Main Features

## 1. DMA Portfolio Prioritisation

The portfolio screen ranks multiple DMAs so utility managers can decide where engineering resources should be deployed first.

Example indicators include:

- NRW %
- minimum-night-flow ratio
- average pressure
- burst history
- asset condition
- risk score
- indicative recoverable leakage
- recommended intervention strategy

Typical output:

| DMA | Risk | NRW | MNF Ratio | Recommended Strategy |
|---|---:|---:|---:|---|
| DMA-12 | 91 | 34.8% | 55% | Hybrid |
| DMA-07 | 85 | 31.6% | 51% | Permanent Monitoring |
| DMA-24 | 72 | 24.7% | 44% | Hybrid |
| DMA-31 | 49 | 18.9% | 26% | Lift & Shift |

This creates a utility-wide view before engineers drill down into individual DMAs.

---

## 2. Interactive DMA Strategy Planner

For each DMA, engineers can configure or edit:

- average pressure
- minimum night flow
- DMA inlet flow
- recent burst count
- number of properties
- total pipe length
- dominant pipe material
- average pipe age
- known background leakage
- repair response time
- target acoustic logger spacing
- average repair cost
- data-quality ratings

The current demo includes four strategy modes:

### Permanent Sensors

Continuous monitoring using fixed acoustic sensors at selected locations.

Best suited to:

- recurring leakage
- critical infrastructure
- metallic networks with good acoustic propagation
- DMAs where rapid detection is valuable

### Lift & Shift

Temporary sensors deployed, analysed, and relocated progressively through the network.

Best suited to:

- lower CAPEX programmes
- large areas requiring progressive screening
- networks where permanent monitoring is not justified
- campaign-based leak detection

### Hybrid

Combines permanent monitoring on high-risk sections with periodic lift-and-shift surveys elsewhere.

This will often be the most practical strategy for utilities with mixed network risk.

### Auto Select

Uses the current DMA inputs to recommend the most suitable strategy.

---

# 3. Intervention Intensity

Users can adjust an **Intervention Intensity** control from conservative to aggressive.

This is intended to represent how strongly the utility wants to pursue leakage reduction.

A lower intervention level may mean:

- fewer sensors
- longer review cycles
- periodic campaigns
- lower programme cost

A higher intervention level may mean:

- denser monitoring
- more frequent campaigns
- faster escalation
- higher manpower allocation
- shorter review intervals

---

# 4. Cost Posture

The prototype separates technical aggressiveness from financial preference.

Available modes include:

### Capex Sensitive

Prioritises lower-cost survey approaches and avoids unnecessary permanent instrumentation.

### Balanced

Balances detection speed, coverage, and cost.

### Maximum Detection

Favors higher coverage, higher intervention intensity, and faster detection.

---

# 5. Explainable Engineering Decision Path

The system displays the reasoning chain used to arrive at a recommendation.

Example:

```text
High Minimum Night Flow
        ↓
Elevated Pressure
        ↓
Older Metallic Network
        ↓
Repeated Bursts
        ↓
Good Acoustic Suitability
        ↓
Hybrid Monitoring Recommended
```

This is intended to make the recommendation auditable rather than presenting an unexplained AI score.

---

# 6. "Why This Recommendation?"

The platform identifies the strongest drivers behind the strategy.

Example:

```text
Why Hybrid?

• Minimum-night-flow is 44% of DMA inlet flow
• Eight bursts occurred in the last 12 months
• Ductile-iron mains provide good acoustic propagation
• The network is moderately aged
• Data quality is sufficient for prioritisation
```

---

# 7. Ask the DMA

The prototype includes an interactive engineering assistant.

Example questions:

- Why are you recommending Hybrid?
- Why not install permanent sensors everywhere?
- What worries you most about this DMA?
- Is the data good enough to act?
- What should the field team do next?
- Is pressure contributing to leakage?
- Is minimum night flow unusually high?
- Which evidence is weakest?

The current GitHub demo answers using transparent client-side rules.

A future production version could connect this interface to:

- an LLM
- utility engineering standards
- historical leak records
- sensor data
- GIS
- hydraulic modelling
- previous confirmed leak / no-leak outcomes

---

# 8. Interactive GIS

The prototype uses:

- **Leaflet**
- **OpenStreetMap**

Users can:

- view DMA locations
- inspect simulated pipe sections
- click individual mains
- view pipe risk
- view material
- view diameter
- view age
- view burst history
- view recommended action
- display proposed monitoring locations

The application also supports **GeoJSON import**.

This allows a user to load a real DMA boundary or pipe network into the prototype.

---

# 9. Pipe-Level Analysis

Individual pipe sections can be assessed separately.

Example:

```text
Pipe P-102

Material: Cast Iron
Diameter: 150 mm
Age: 48 years
Recent Bursts: 5
Pipe Risk: 91 / 100

Recommended Action:
Immediate acoustic investigation followed by
correlation and ground confirmation.
```

The long-term goal is to make the platform capable of recommending detection technology at individual asset level.

---

# 10. Technology Suitability

The prototype evaluates different leak-detection methods.

Current methods include:

- acoustic loggers
- correlators
- hydrophones
- pressure logging
- step testing
- transient monitoring
- satellite screening
- ground microphones

Example:

```text
Acoustic Loggers       84%
Correlation            92%
Hydrophones             67%
Pressure Logging        76%
Step Testing            81%
Transient Monitoring    61%
Satellite Screening     55%
Ground Microphone       79%
```

The intent is to help engineers choose the right tool rather than treating every DMA the same way.

---

# 11. AI Leak Noise Classification

Users can upload a leak-noise recording directly into the browser.

Supported formats depend on the browser, but commonly include:

- WAV
- MP3
- M4A

The prototype calculates basic acoustic features locally:

- RMS energy
- crest factor
- zero-crossing behaviour
- approximate spectral centroid
- sample rate
- duration

The system then produces an indicative classification:

### Probable Leak Noise

The recording contains acoustic characteristics consistent with a steady leak-like signal.

### Possible Leak / Review

Some leak-like characteristics are present, but additional evidence is required.

### Low Leak Likelihood

The signal is less consistent with a continuous leak signature.

A waveform is also displayed.

---

## Important Acoustic Disclaimer

The current browser classifier is a **demonstration**, not a trained production leak-detection model.

A real implementation should be developed using labelled field recordings including:

- confirmed leaks
- confirmed non-leaks
- traffic noise
- pumps
- valves
- consumer use
- electrical noise
- mechanical plant
- intermittent flow
- different pipe materials
- different pipe diameters
- different pressures
- different sensor types

Useful contextual inputs should include:

```text
Audio Signal
+
Sensor Type
+
Pipe Material
+
Pipe Diameter
+
Pressure
+
Sensor Spacing
+
Neighbouring Sensor Signals
+
Time of Day
+
Confirmed Leak Outcome
```

The objective is not merely to classify noise.

The larger opportunity is to combine acoustic evidence with network context.

---

# 12. Campaign Workflow

A recommended strategy can be converted into a field campaign.

Example campaign:

```text
DMA-24 Priority Leakage Survey

1. Validate inlet flow meter
2. Validate pressure logger timestamps
3. Review GIS and identify priority mains
4. Deploy acoustic loggers
5. Perform lift-and-shift survey
6. Review strongest suspects
7. Correlate suspected leak sections
8. Ground-confirm leak positions
9. Raise repair work
10. Record confirmed leak / no-leak result
```

This closes the gap between analytics and field operations.

---

# 13. Field Verification Gate

A central product principle is:

> **AI identifies where to investigate. It does not automatically approve excavation.**

Before excavation, utilities should require field confirmation appropriate to the network and leak type.

Examples include:

- correlator verification
- ground microphone
- hydrophone
- step test
- pressure response
- visual confirmation
- utility-approved alternative method

---

# 14. ROI & Payback

The platform includes a simple management-level investment model.

Inputs include:

- estimated recoverable leakage
- value of water
- programme cost
- expected recovery success rate

Outputs include:

- annual recovered-water value
- first-year net benefit
- simple payback period

Example:

```text
Recoverable Leakage:       520 m³/day
Water Value:               $1.35/m³
Recovery Success:          78%
Programme Cost:            $198,000

Annual Water Value:        $199,692
Simple Payback:            11.9 months
```

A production implementation could additionally include:

- treatment cost
- pumping / energy cost
- avoided burst costs
- avoided emergency repairs
- customer disruption
- regulatory penalties
- carbon impact
- asset-life extension

---

# 15. Data Quality & Confidence

The prototype allows users to rate:

- flow data
- pressure data
- GIS data

Recommendation confidence is reduced when data quality is poor.

This is important because:

```text
Bad data should not create a highly confident recommendation.
```

Future versions could automatically calculate data quality using:

- missing readings
- time-series gaps
- meter drift
- pressure logger synchronisation
- impossible values
- GIS topology errors
- sensor communication reliability

---

# Demo Data

All current DMA values are simulated.

The prototype includes sample scenarios such as:

- High NRW / High Pressure
- Aged Metallic Network
- Low Acoustic Suitability
- Good Performing DMA

There is also a **Randomise Scenario** function for demonstrating how the recommendations respond to changing inputs.

---

# Saving Scenarios

The demo supports browser-based scenario saving using `localStorage`.

This allows users to:

- save a DMA configuration
- close the page
- reopen it
- reload the previous scenario

This is local to the browser and is not a cloud database.

---

# Export

Strategy results can be exported as JSON.

A production system could later export:

- PDF strategy reports
- engineering recommendations
- GIS layers
- CSV
- work orders
- field campaign sheets
- asset inspection records

---

# Mapping Architecture

## Current Demo

```text
Leaflet
   ↓
OpenStreetMap Raster Tiles
   ↓
Demo DMA / Pipe Geometry
```

No API key is required.

## Production Options

A utility implementation could connect to:

- Esri ArcGIS
- Mapbox
- MapTiler
- MapLibre
- GeoServer
- WMS
- WMTS
- vector tiles
- PostGIS
- utility-hosted GIS services
- GeoJSON
- shapefile-converted network assets

For real deployments, water-network geometry should normally come directly from the utility's GIS.

---

# Production Architecture Concept

A possible future architecture:

```text
                  ┌──────────────────┐
                  │      Utility      │
                  │       GIS         │
                  └────────┬─────────┘
                           │
                ┌──────────▼──────────┐
                │ Network / Asset DB  │
                └──────────┬──────────┘
                           │
 ┌───────────────┐   ┌─────▼──────┐   ┌────────────────┐
 │ Flow / Meter  │──▶│ DMA Engine │◀──│ Pressure Data  │
 └───────────────┘   └─────┬──────┘   └────────────────┘
                           │
                  ┌────────▼─────────┐
                  │ Strategy Engine  │
                  └────────┬─────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
 ┌────────▼──────┐ ┌───────▼──────┐ ┌──────▼───────┐
 │ Acoustic AI   │ │ Hydraulic     │ │ Asset Risk   │
 │ Classification│ │ Analysis      │ │ Model        │
 └────────┬──────┘ └───────┬──────┘ └──────┬───────┘
          │                │                │
          └────────────────┼────────────────┘
                           │
                   ┌───────▼───────┐
                   │ Explainable AI│
                   └───────┬───────┘
                           │
                   ┌───────▼───────┐
                   │ Field Campaign│
                   └───────┬───────┘
                           │
                   ┌───────▼───────┐
                   │ Repair Outcome│
                   └───────┬───────┘
                           │
                           └───────▶ learning dataset
```

The most valuable data in the long term may be the feedback loop:

```text
Prediction
→ Field Investigation
→ Leak / No Leak
→ Repair
→ Recovered Flow
→ Model Improvement
```

---

# Product Direction

Aqua Intelligence is intended as a **decision-support platform**, not simply another water dashboard.

The long-term product should help answer:

### Portfolio Level

- Which DMA should we investigate first?
- Where will the utility obtain the largest NRW reduction?
- Where should CAPEX be allocated?

### DMA Level

- Is the DMA behaving abnormally?
- Is minimum night flow significant?
- Is pressure driving leakage?
- What detection strategy is appropriate?
- How aggressive should the intervention be?

### Pipe Level

- Which assets are highest risk?
- Which technology is most suitable?
- Where should sensors be installed?
- Which pipes require field investigation?

### Acoustic Level

- Does this recording resemble a leak?
- Could it be traffic, pump, valve, or consumer noise?
- How does it compare with neighbouring sensors?
- Does the signal persist over time?

### Operational Level

- Who should investigate?
- What equipment is required?
- What should happen next?
- Has the suspected leak been confirmed?
- What volume was recovered?

---

# Future Development Roadmap

## Phase 1 — Interactive Prototype

Current repository.

- DMA portfolio
- GIS
- strategy planner
- technology suitability
- Ask the DMA
- ROI
- campaign workflow
- prototype acoustic analysis

## Phase 2 — Real Data Integration

Connect:

- GIS
- DMA flow meters
- pressure loggers
- acoustic logger exports
- burst history
- repair records
- asset database

## Phase 3 — Engineering Models

Introduce:

- DMA water balance
- minimum-night-flow analysis
- pressure-leakage relationships
- sensor-placement optimisation
- acoustic propagation rules
- pipe failure / burst risk
- hydraulic model integration

## Phase 4 — Machine Learning

Train models from:

- labelled acoustic recordings
- confirmed leak / no-leak events
- sensor alarms
- leak positions
- asset condition
- repair outcomes
- recovered flow

## Phase 5 — Utility Operations Platform

Add:

- user accounts
- work orders
- technician assignments
- mobile field application
- repair closure
- automatic sensor ingestion
- alerts
- management reports
- KPI dashboards
- audit history

---

# Running Locally

The current build is a single HTML file.

You can open:

```text
index.html
```

directly in a browser.

For a simple local HTTP server:

```bash
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

---

# Publishing on GitHub Pages

1. Place `index.html` in the repository root.
2. Open the repository in GitHub.
3. Go to:

```text
Settings → Pages
```

4. Select:

```text
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

5. Save.

The site should then publish under:

```text
https://<github-user>.github.io/<repository-name>/
```

---

# Why the Single-File Build?

Earlier prototype versions used:

```text
index.html
styles.css
app.js
```

During rapid GitHub Pages updates, browsers can occasionally retain an older CSS or JavaScript asset while loading newer HTML.

The current build embeds all application CSS and JavaScript directly in `index.html`.

Advantages:

- no asset-version mismatch
- easier GitHub deployment
- easier sharing
- easier prototype testing

External dependencies are currently limited primarily to Leaflet and the basemap service.

---

# Current Limitations

This prototype does **not** currently provide:

- validated hydraulic calculations
- production-grade sensor-placement optimisation
- trained leak-noise machine learning
- live telemetry
- backend database
- authentication
- multi-user collaboration
- real work-order management
- production GIS topology analysis
- automated excavation approval

Those are deliberate future-development items.

---

# Engineering Principle

The product should never present an AI recommendation as unquestionable truth.

A useful NRW platform should show:

```text
Recommendation
+
Evidence
+
Confidence
+
Assumptions
+
Alternative Strategies
+
Required Verification
```

That is the philosophy behind Aqua Intelligence.

---

## Prototype Status

**Version:** v6 single-file prototype  
**Purpose:** Concept demonstration / product exploration  
**Data:** Simulated  
**Engineering calculations:** Illustrative  
**Field validation:** Required
