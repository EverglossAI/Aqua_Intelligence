# GitHub Copilot instructions — Aqua Intelligence

## Mandatory specifications

Before making any change, identify which repository specifications apply.

- For **hydraulic modelling, topology-to-hydraulic conversion, EPANET integration, hydraulic diagnostics, model-quality assessment, calibration/validation, DMA hydraulic analysis/design, pressure management, hydraulic scenario logic, or AI explanations of hydraulic results**, you MUST read and follow:
  - `architecture/HYDRAULIC_REASONING_SPEC.md`
- For **UI/UX changes**, you MUST read and follow:
  - `AQUA_UX_SPEC.md`

If a requested change touches both hydraulic engineering and UI, both specifications apply.

For hydraulic work, `architecture/HYDRAULIC_REASONING_SPEC.md` is the authoritative engineering contract. Do not substitute your own hydraulic rules, thresholds, confidence logic, calibration logic, or causal conclusions. If implementation convenience, legacy behavior, or an AI-generated suggestion conflicts with that specification, the specification wins unless the human owner explicitly changes it.

## Hydraulic engineering rules

- AI interprets. Deterministic engineering decides. Evidence controls confidence.
- Do not let an LLM calculate hydraulic results or invent engineering values.
- Do not promote POSSIBLE to SUPPORTED/CONFIRMED.
- Do not bypass model-basis, evidence, calibration, validation, scope, or fit-for-purpose gates.
- Preserve provenance and distinguish measured, surveyed, GIS, derived, DEM, assumed, synthetic, and unknown evidence.
- Never treat DEM as surveyed RL or pipe invert.
- Never treat gauge pressure as EPANET reservoir total head without the required elevation/reference basis.
- Never call a model calibrated merely because its inputs are high quality.
- Never call sensitivity testing calibration.
- Never use weak/unmapped observations as calibration-quality evidence.
- Never silently change source GIS, topology, valve state, diameter, demand, roughness, source head, or other engineering inputs.
- Roughness calibration and mutation-capable hydraulic actions remain blocked unless explicitly authorized and all specification gates are satisfied.
- Every new hydraulic rule must be deterministic and tested in both a positive and a blocking/uncertain case.
- Before coding a hydraulic milestone, identify the relevant sections of `architecture/HYDRAULIC_REASONING_SPEC.md` and state any proposed deviation before implementation.

## Coding rules
- Keep the current application framework-free unless an explicit milestone changes that: plain HTML, CSS and JavaScript.
- Preserve Leaflet and existing deterministic engineering functions.
- Prefer extraction/reuse over deleting working logic.
- Do not introduce build tooling unless strictly necessary.
- Do not add secrets or API tokens.
- Keep Cloudflare Worker/static-assets compatibility.
- Avoid giant rewrites when a smaller structural edit works.
- Maintain graceful fallback if an optional DOM element is absent.
- Do not allow one missing optional control to stop map startup.
- Preserve source project/GIS data unless the task explicitly calls for an authorized mutation.

## Architecture

Aqua follows this engineering hierarchy:

```text
User intent
  -> evidence resolution
  -> deterministic GIS / topology / hydraulic / analytical tools
  -> deterministic reasoning
  -> structured result
  -> AI explanation
```

The map-first application continues to use:
1. full-screen map shell
2. WindowManager
3. floating tool windows
4. taskbar/dock
5. global command bar
6. basemap/layer controls
7. shared investigation context
8. deterministic domain engines

WindowManager requirements:
- registerWindow(id, options)
- open/focus
- drag
- resize
- minimize
- restore
- close
- localStorage persistence
- z-index stacking
- viewport clamping

## Preserve these behaviours
- project/GIS import and rendering
- DMA rendering and logical-DMA behavior
- selected-asset inspection
- topology review semantics
- acoustic operational data behavior
- comparison tools
- elevation/environmental context
- leak-risk evidence rules
- hydraulic reasoning and EPANET provenance
- read-only AI routing unless a future explicitly authorized milestone changes it

## Quality gate

Before considering a milestone complete:
- run the applicable test suite;
- run syntax checks;
- run `git diff --check`;
- verify no secret/deployment spillover;
- test positive and failure/blocking paths for engineering logic;
- verify AI cannot override deterministic classifications;
- browser-test relevant desktop/mobile layouts;
- report exact files changed and any model-basis impact.

For hydraulic milestones specifically:
- report which sections of `architecture/HYDRAULIC_REASONING_SPEC.md` were implemented or affected;
- report whether model-basis, calibration, validation, or fit-for-purpose status changed;
- do not increase trust classification unless new evidence justifies it;
- stop before commit/deploy whenever the human request says to stop.
