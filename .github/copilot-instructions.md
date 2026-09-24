# Copilot instructions — Aqua Intelligence V2

You are working on the Aqua Intelligence V2 architecture.

## Non-negotiable principles
1. Do not add major new logic to the legacy root `index.html`, root `app.js`, or the existing cockpit monolith.
2. Preserve the existing NRW cockpit as a working reference/demo while V2 is built alongside it.
3. New capabilities must be modular, testable, and callable independently of the UI.
4. Deterministic engineering calculations remain authoritative. An LLM may interpret intent, orchestrate tools, and explain results, but must not invent hydraulic outputs, risk scores, telemetry, or engineering facts.
5. Any action that changes map state, filters, selected assets, hydraulic scenarios, or planning outputs should be represented as a structured command before UI execution.
6. Prefer explicit typed/validated JSON contracts between modules.

## V2 target architecture
Create new code under:
- `v2/core/intent/`
- `v2/core/router/`
- `v2/core/network/`
- `v2/core/hydraulics/`
- `v2/core/dma/`
- `v2/core/risk/`
- `v2/core/acoustics/`
- `v2/core/telemetry/`
- `v2/ai/`
- `v2/ui/`
- `v2/tests/`

## Intent Engine
The first implementation phase is the Intent Engine and command router.

Initial intent taxonomy:
- MAP_COMMAND
- DATA_QUERY
- ASSET_LOOKUP
- FILTER_REQUEST
- ALARM_QUERY
- SENSOR_STATUS
- TREND_QUERY
- REPORT_REQUEST
- KNOWLEDGE_QUERY
- ANALYSIS_REQUEST
- DEPLOYMENT_PLANNING
- DMA_DESIGN
- HYDRAULIC_SCENARIO
- UNKNOWN

The parser must return a structured result such as:
```json
{
  "intent": "FILTER_REQUEST",
  "confidence": 0.98,
  "entities": {
    "asset_type": "pipe",
    "material": "PVC"
  },
  "route": "gis",
  "requires_llm": false,
  "commands": []
}
```

Start with deterministic matching and entity extraction for obvious commands. Design a classifier interface so a cheap Cloudflare Workers AI model can be inserted later for ambiguous requests without changing the rest of the application.

## Routing order
1. deterministic command / rule matcher
2. lightweight intent classifier when required
3. deterministic domain tools (GIS, telemetry, database, hydraulics, DMA, acoustics)
4. general reasoning model only when explanation or multi-step reasoning is required
5. premium model fallback only for difficult cases

## Hydraulic / DMA direction
Design interfaces now, but do not fake hydraulic calculations.

The future hydraulic engine will use EPANET-compatible principles and must support:
- node elevations
- demands
- pipes and roughness
- valves
- pumps
- tanks/reservoirs
- pressure/head
- flow
- velocity
- headloss
- scenario runs
- minimum residual pressure checks

The DMA design engine will ultimately consider:
- network topology/connectivity
- elevation and hydraulic grade
- target DMA size / service connections
- boundary valves
- candidate inlet meters
- minimum pressure constraints
- number of meter points
- resilience / alternate feeds
- dead-end and low-velocity risks
- leak/burst risk layers

## AI provider
Prepare an abstraction for Cloudflare Workers AI. The likely default reasoning model is a low-cost Qwen model, but the provider/model name must be configurable. Do not hard-code credentials.

## Engineering safeguards
- Never allow LLM output to directly modify engineering state without validation.
- Hydraulic results must come from a solver, not generated prose.
- Risk scores must expose factors/weights or source data.
- Every AI-derived recommendation must preserve provenance: input facts, tool results, and model explanation should be distinguishable.
- Unknown or unsupported requests must fail safely and visibly.

## Phase 1 acceptance criteria
Implement only the backbone first:
1. V2 folder structure.
2. Intent Engine.
3. Entity extraction for common map/data commands.
4. Command Router.
5. Mock adapters for GIS, telemetry, hydraulics, and DMA.
6. A simple V2 demo panel showing:
   - user query
   - detected intent
   - extracted entities
   - selected route
   - generated structured command(s)
   - mock result
7. Automated tests for representative intents.
8. Documentation describing extension points.

Representative tests should include:
- "Show DMA 12"
- "What is the pressure at PRV-03?"
- "List active leak alarms"
- "Show PVC pipes older than 20 years"
- "Hide accelerometers"
- "Why is this pipe high risk?"
- "Plan a 12-hydrophone lift-and-shift deployment"
- "Design a DMA here and keep minimum pressure above 25 m"
- "What happens if I close these two valves?"

Do not implement fake EPANET outputs in Phase 1. Hydraulic and DMA requests should route correctly to adapters and return an explicit not-yet-simulated state.

## Working style
Make small, reviewable commits. Avoid broad rewrites. Keep existing cockpit behavior intact. Add or update tests with each functional change.


## UI shell requirements — map-first workspace
The V2 main screen must be the map itself, occupying the full application canvas.

### Basemap / terrain controls
The map must support clean switching or layering between:
- standard map/street view
- satellite imagery
- elevation/terrain visualization

Elevation should be treated as both:
1. a visual layer (e.g. terrain shading/contours where supported), and
2. engineering data tied to the network model.

### Floating workspace model
All command panels, dialogs, result panels, analysis windows, and tool palettes should float above the map rather than permanently consume layout space.

Each floating window should:
- be draggable
- be independently movable anywhere over the map
- support minimize
- support restore
- support close where appropriate
- preserve its position/state during the current session
- have a compact title bar and minimal chrome
- avoid blocking large areas of the map by default

### Bottom taskbar
Minimized tools/windows should collapse into a compact taskbar along the bottom edge of the application.

The taskbar should:
- show minimized tools as small labeled buttons/icons
- restore a panel when clicked
- remain visually quiet when few tools are open
- avoid covering important map controls

### Visual style
The interface should be:
- clean
- modern
- restrained
- engineering-focused
- map-dominant

Avoid dashboard clutter, permanent sidebars, oversized cards, and large fixed headers.

Use translucent or lightly elevated floating panels where appropriate, but preserve readability over both light street maps and dark/satellite imagery.

### Interaction principle
The product should feel like a map-centric engineering operating system:
- map = workspace
- floating windows = tools
- bottom taskbar = minimized work
- intent/command box = one floating tool among others, not the whole product

### Phase 1 UI acceptance criteria
The V2 demo panel must be implemented using the floating-window system rather than as a fixed page section.

At minimum demonstrate:
- one draggable command/intent window
- one draggable results/debug window
- minimize both to the bottom taskbar
- restore from the taskbar
- switch between standard map and satellite
- show an elevation/terrain layer control even if the engineering elevation dataset is not yet connected

Do not hard-code a dashboard layout that would later need to be discarded.
