# Aqua Hydraulic Reasoning Specification v1.0

Status: **Authoritative engineering logic for hydraulic reasoning and AI-assisted hydraulic workflows**

Applies to hydraulic model construction, diagnostics, model-quality assessment, calibration readiness, DMA analysis/design, AI explanations, scenario testing, and future automated engineering assistance.

## 0. Non-negotiable architecture

Aqua SHALL preserve this hierarchy:

~~~text
User intent
  -> evidence resolution
  -> deterministic GIS/topology/hydraulic tools
  -> engineering reasoning rules
  -> structured diagnosis
  -> AI explanation
~~~

The LLM/AI layer MUST NOT:
- calculate hydraulic results itself;
- invent pipe, node, valve, pressure, flow, elevation, demand, roughness or model values;
- promote POSSIBLE to SUPPORTED or CONFIRMED;
- override deterministic model-quality or fit-for-purpose gates;
- silently modify source GIS, valve state, pipe diameter, roughness, demand, topology, source head, calibration parameters or project data;
- call a model calibrated merely because input quality is high;
- treat DEM terrain as surveyed node RL or pipe invert.

The deterministic reasoning engine is authoritative. The AI is an interpreter/orchestrator only.

## 1. Core hydraulic principles

Aqua SHALL reason from continuity and energy relationships implemented by EPANET.

For a junction:

~~~text
hydraulic head = elevation head + pressure head
~~~

For source/boundary conditions:
- EPANET reservoir input is **total hydraulic head**, not raw gauge pressure.
- A pressure reading MUST NOT be used directly as reservoir head unless its reference/elevation basis makes that valid.
- Where applicable:

~~~text
total head ~= boundary elevation + pressure head
~~~

Velocity head must be handled explicitly where material.

Aqua SHALL distinguish pressure head, elevation, hydraulic grade/total head, energy loss, and control-device effects.

## 2. Model result is not network truth

Every hydraulic conclusion MUST pass four gates:

1. **Model validity** — did a coherent model solve?
2. **Evidence validity** — are relevant inputs mapped, timely and sufficiently trustworthy?
3. **Diagnostic validity** — does the hydraulic signature support the candidate cause?
4. **Fit for purpose** — is this model adequate for the requested decision?

A successful EPANET solve alone MUST NOT authorize an engineering conclusion.

## 3. Evidence taxonomy

Hydraulic logic MUST use structured provenance, not free-text substring tests.

Allowed source types:

~~~text
FIELD_MEASURED
FIELD_VERIFIED
SURVEYED
UTILITY_GIS
SCADA
BILLING_DATA
DERIVED_TOPOLOGY
DEM
ESTIMATED
ASSUMED
SYNTHETIC
UNKNOWN
~~~

Relevant evidence SHOULD carry:

~~~text
value
unit
sourceType
sourceName
confidence
timestamp
timeWindow
mappingMethod
uncertainty
usage
~~~

Confidence:

~~~text
HIGH
MEDIUM
LOW
UNKNOWN
~~~

Confidence is contextual. DEM may be useful for preliminary terrain context but invalid as surveyed pipe invert.

Legacy free-text fields may remain for compatibility, but engineering logic SHALL normalize them to typed provenance at the boundary.

## 4. Model basis, calibration, validation and fit-for-purpose are separate

### Model basis

~~~text
NOT_USABLE
PRELIMINARY
SCREENING_READY
HIGH_QUALITY_BASIS
~~~

### Calibration

~~~text
UNCALIBRATED
CALIBRATION_IN_PROGRESS
CALIBRATED_FOR_USE_CASE
~~~

### Validation

~~~text
NOT_VALIDATED
VALIDATED_FOR_USE_CASE
~~~

Validation requires explicit independent observations not used for calibration.

### Fit for purpose

Examples:

~~~text
VISUALISATION
HYDRAULIC_SCREENING
OPERATIONAL_DIAGNOSIS
DESIGN_SCENARIO
PRESSURE_MANAGEMENT
FAILURE_SCENARIO
~~~

Aqua MUST NOT infer CALIBRATED or VALIDATED from high input quality.

## 5. Scope-aware model quality

Quality assessment MUST support:

~~~text
PROJECT
DMA
PATH
ASSET
SCENARIO
~~~

A project-level defect MUST NOT automatically invalidate an unrelated DMA unless it can influence that DMA. A good project-level score MUST NOT hide a broken DMA/path.

Every diagnosis SHOULD return project quality, scoped quality, relevant blocking limitations, and irrelevant/global limitations separately.

Strong conclusions SHALL depend on scoped quality.

## 6. DMA boundary integrity

A DMA is a hydraulically discrete zone, not merely a polygon.

For every logical DMA, Aqua SHALL identify hydraulic network crossings of the logical DMA boundary and classify each crossing:

~~~text
METERED_INLET
METERED_OUTLET
VERIFIED_CLOSED_BOUNDARY_VALVE
OPEN_CONNECTION
UNKNOWN_STATUS
GEOMETRY_REVIEW
~~~

DMA integrity states:

~~~text
VERIFIED
PLAUSIBLE
INCOMPLETE
NOT_ISOLATED
UNKNOWN
~~~

Rules:
- unexplained OPEN_CONNECTION -> NOT_ISOLATED;
- UNKNOWN_STATUS affecting a crossing prevents VERIFIED status;
- a polygon alone never proves hydraulic isolation;
- Aqua MUST NOT automatically close a pipe/valve to force DMA isolation;
- only positively identified source assets may be called valves/PRVs/etc.;
- field evidence such as confirmed valve position or zero-pressure test may raise confidence.

If boundary integrity is inadequate, Aqua MUST NOT treat one inlet flow meter as complete DMA water-balance evidence.

## 7. Boundary/inlet representation

Each DMA boundary/inlet SHOULD independently retain:

~~~text
boundaryId
meterId
sourceCoordinate
mappedNodeOrLink
mappingMethod
mappingDistanceMetres
mappingConfidence
boundaryElevationMetres
pressureHeadMetres
totalHeadMetres
flowMeasurement
timestamp/timeWindow
provenance
~~~

A single global source head MUST NOT be treated as equivalent to measured per-boundary HGL.

Boundary mapping preference:
1. explicit persisted asset->node/link mapping;
2. field/GIS verified relationship;
3. nearest spatial mapping.

Default automatic spatial mapping classes:

~~~text
<=25 m       STRONG
>25 to 100 m REVIEW
>100 m       WEAK
~~~

Thresholds are configurable policy values. Weak mapping blocks strong diagnosis.

## 8. Observation mapping

Pressure/flow observations SHOULD prefer explicit model linkage over nearest-node snapping.

For automatically mapped pressure loggers:
- STRONG mappings may contribute to residual statistics;
- REVIEW mappings may contribute only if explicitly allowed and visibly flagged;
- WEAK mappings MUST NOT contribute to calibration-quality MAE/RMSE by default.

Each mapping SHALL retain mappingMethod, modelElementId, snapDistanceMetres, mappingConfidence, includedInResidualStatistics, and exclusionReason.

The historical 1000 m acceptance is not a valid calibration-quality default.

## 9. Time basis is part of hydraulic evidence

Every model/field comparison SHALL declare:

~~~text
mode: SNAPSHOT | WINDOW | EPS
timestamp
start
end
timezone
aggregation
~~~

A time-specific hydraulic result MUST NOT be compared against an unconditional whole-series logger mean and called a calibration residual.

Classify comparison as:

~~~text
CALIBRATION_RESIDUAL
VALIDATION_RESIDUAL
DESCRIPTIVE_MISMATCH
UNALIGNED
~~~

Only time-compatible observations may become calibration/validation residuals.

## 10. Demand model

Aqua SHALL separate total DMA demand confidence, spatial allocation confidence, and temporal pattern confidence.

Demand allocation strategies:

~~~text
UNIFORM_SERVICE_CONNECTION
CUSTOMER_COUNT_WEIGHTED
METER_CONSUMPTION_WEIGHTED
BILLING_WEIGHTED
LAND_USE_WEIGHTED
ENGINEER_DEFINED
UNKNOWN
~~~

Current Lambay equal allocation is UNIFORM_SERVICE_CONNECTION and provisional.

Matching DMA inlet total demand does NOT prove spatial allocation is correct.

## 11. DDA vs PDA

Hydraulic scenario metadata MUST explicitly identify DDA or PDA.

DDA:
- suitable for normal screening/design where adequate pressure is expected;
- negative pressure indicates a pressure-deficient/physically invalid state, not successful demand delivery.

PDA:
- suitable for pressure-deficient/intermittent/failure scenarios;
- requires explicit policy values for minimum pressure, required pressure and pressure exponent.

Aqua MUST NOT silently switch modes or invent PDA values.

## 12. Engineering policy profiles

Hydraulic thresholds are policy/guideline inputs, not universal physical laws.

A profile SHOULD provide:
- serviceMinimumPressure;
- serviceMaximumPressure;
- designTargetPressure;
- velocityAdvisory;
- velocitySevere;
- headlossAdvisory;
- headlossSevere;
- loggerResidualScreening;
- loggerResidualUnreliable;
- mappingStrongDistance;
- mappingReviewDistance.

Threshold provenance:

~~~text
AQUA_SCREENING_DEFAULT
UTILITY_DEFINED
PROJECT_DEFINED
REGULATORY
~~~

Every threshold-based finding SHOULD expose threshold and basis.

## 13. Diagnostic grammar

Every deterministic diagnostic SHALL use this structure where applicable:

~~~text
code
scope
observation
threshold
modelBasis
calibrationState
validationState
fitForPurpose
affectedAssets
measuredEvidence
modeledEvidence
candidateCauses
counterEvidence
recommendedChecks
discriminatingScenarioTests
confidence
evidenceClassification
networkConclusion
~~~

Candidate-cause assessment values:

~~~text
SUPPORTED
POSSIBLE
UNSUPPORTED
CANNOT_EVALUATE
~~~

AI MUST preserve these statuses exactly.

## 14. Physical failure vs service/design criteria

Aqua SHALL distinguish:
- PHYSICAL/SOLVER CONDITION;
- SERVICE NON-COMPLIANCE;
- DESIGN TARGET.

Negative DDA pressure is not the same as pressure below a utility minimum.

## 15. Low-pressure reasoning

For low service pressure, evaluate in this order:

1. Is the result time-aligned with field evidence?
2. Is scoped model basis adequate?
3. Is boundary/source HGL credible?
4. Is node/logger elevation credible?
5. Is static head alone sufficient to explain pressure?
6. Is upstream path headloss excessive?
7. Are diameter and roughness inputs credible?
8. Is demand credible and unusually concentrated/high?
9. Is a valve/PRV/pump/control state relevant and known?
10. Is topology/path connectivity credible?
11. Do nearby field loggers show a consistent pattern?

Candidate causes:

~~~text
INADEQUATE_SOURCE_HGL
HIGH_ELEVATION
EXCESSIVE_FRICTION_LOSS
UNDERSIZED_MAIN_CANDIDATE
EXCESSIVE_DEMAND
VALVE_OR_CONTROL_RESTRICTION
TOPOLOGY_ERROR
INCORRECT_ELEVATION
OBSERVATION_MAPPING_ERROR
TIMING_MISMATCH
~~~

Do not identify a primary cause unless evidence supports discrimination.

## 16. High-pressure reasoning

Evaluate credible boundary HGL, low elevation, low-demand condition, PRV/control state, source/tank operating condition, logger elevation/mapping, and temporal alignment.

Aqua MUST NOT recommend pressure reduction until the critical pressure point and required service minimum are known for intended operating conditions.

## 17. Headloss/velocity reasoning

High headloss or velocity is an observation, not automatically an undersized pipe.

Before calling a main an undersized candidate require:
- verified/credible diameter;
- credible flow/demand;
- credible topology;
- credible boundary conditions;
- non-service-main classification;
- meaningful segment length;
- headloss concentration on the relevant path;
- scenario sensitivity showing a larger verified diameter materially changes the result.

Alternative causes include bad diameter, wrong roughness, wrong demand, wrong valve/control state, topology error and service-pipe artefact.

## 18. Residual reasoning

For time-aligned model/field pressure data, Aqua SHOULD calculate mean residual, MAE, RMSE, bias, residual standard deviation, residual-vs-flow/demand relationship, spatial consistency, and useful change points.

Residual signatures MAY prioritize hypotheses but do not prove cause:
- near-constant local bias -> elevation/datum/sensor/mapping candidate;
- similar bias across many loggers -> common boundary HGL/datum candidate;
- error grows with flow -> resistance/diameter/restriction candidate;
- error low at night and large at peak -> resistance/demand/connectivity candidate;
- phase/timing mismatch -> demand-pattern/time-sync candidate;
- abrupt step -> operational/data discontinuity candidate.

Use wording such as "consistent with" until a discriminating test supports causation.

## 19. Every hypothesis needs a discriminating test

Aqua SHALL pair meaningful candidate causes with the next deterministic test that could distinguish them.

Examples:

~~~text
Suspected source HGL
-> test measured boundary HGL

Suspected undersized trunk
-> run verified larger-diameter sensitivity scenario

Suspected valve restriction
-> compare verified/open/closed scenario only where valve existence is confirmed

Suspected roughness
-> sensitivity test plausible roughness range
~~~

Sensitivity is NOT calibration. Aqua MUST NOT infer a sensitivity value is the true field value merely because fit improves.

## 20. Stress-condition logic

Calibration/diagnosis SHOULD use multiple hydraulic conditions where the use case requires it:

~~~text
LOW/NIGHT FLOW
NORMAL
PEAK
HIGH-STRESS
FIRE/EMERGENCY where applicable
SINGLE-INLET/OUTAGE where applicable
~~~

Agreement under one low-flow state MUST NOT validate resistance-related parameters by itself.

## 21. Calibration readiness

Calibration SHALL remain BLOCKED while material unresolved issues remain in:
1. topology/connectivity;
2. DMA boundary integrity;
3. operational valve/control state;
4. pipe diameter;
5. elevations/datums;
6. boundary HGL;
7. observation mapping;
8. time alignment;
9. demand totals;
10. spatial/temporal demand basis.

Only after these are sufficiently resolved may roughness or other uncertain parameters be calibrated.

Calibration MUST declare the use case, dataset/time periods, parameters changed, allowed bounds, pre/post metrics and provenance. Validation MUST use independent data not used for calibration.

## 22. Model representation / skeletonization

Every scenario SHALL state:

~~~text
FULL_NETWORK
DISTRIBUTION_MAIN
SKELETONIZED
~~~

Fit-for-purpose depends on representation. A service-line artefact MUST NOT be presented as equivalent to a distribution-main bottleneck.

## 23. Pressure-management / PRV reasoning

Pressure management must protect the critical point, not merely reduce inlet pressure.

Workflow:

~~~text
identify critical point
-> establish required service minimum
-> verify field/model agreement
-> simulate PRV/control scenario
-> test low/normal/peak conditions
-> verify every relevant node
-> verify critical point
-> assess excessive pressure elsewhere
~~~

PRV state awareness:
- ACTIVE: downstream setpoint control may be expected;
- OPEN: upstream head may be insufficient to maintain setpoint;
- CLOSED: reverse-flow/control condition may exist.

Expected control behavior MUST NOT be misdiagnosed as a fault.

## 24. DMA design logic

A proposed DMA design SHALL pass sequential gates:
1. topology;
2. boundary integrity;
3. metering;
4. supply;
5. elevation;
6. normal demand;
7. peak demand;
8. low/night demand;
9. hydraulic losses;
10. redundancy;
11. operability;
12. use-case-specific fire/emergency/water-quality requirements where relevant.

Aqua SHALL NOT call a DMA design "good" based on polygon geometry or one EPANET run.

Scenario comparison SHOULD expose minimum/maximum/critical-node pressure, maximum main velocity/headloss, unserved demand, boundary flows, inlet count, unexplained crossings, isolated nodes/customers, model basis and fit-for-purpose.

## 25. Recommendation classes

Recommendations SHALL be classified:

~~~text
DATA_IMPROVEMENT
FIELD_VERIFICATION
HYDRAULIC_SCENARIO
OPERATIONAL_REVIEW
DESIGN_OPTION
~~~

A recommendation must never be stronger than the evidence/model-quality gate permits.

## 26. AI explanation rules

AI may translate deterministic results into plain language, explain concepts, resolve intent/entities, request missing information, compare deterministic scenarios, explain blocked conclusions, and recommend deterministic/field checks already authorized by the engine.

AI MUST NOT:
- create a new engineering cause not present in structured diagnostics;
- change evidence classification;
- hide limitations;
- describe synthetic/demo telemetry as field measurement;
- describe DEM as surveyed elevation;
- call sensitivity analysis calibration;
- call an unvalidated model field-proven;
- recommend operational changes as safe solely because a language model prefers them.

Outputs SHOULD distinguish:
- CONFIRMED/MEASURED FACT;
- MODELLED INDICATION;
- SUPPORTED DIAGNOSIS;
- POSSIBLE HYPOTHESIS;
- CANNOT EVALUATE;
- NEXT CHECK.

## 27. Current Lambay guardrails

Until explicitly improved with new evidence, Lambay remains:
- PRELIMINARY;
- flat assumed hydraulic node elevation;
- assumed 55 m source heads;
- uncalibrated roughness;
- unresolved topology;
- excluded components;
- suspicious diameter records;
- pressure/flow telemetry synthetic/demo;
- current logger comparison historical/descriptive rather than proof of calibration.

No future milestone may silently increase trust merely because code architecture improves.

## 28. Known current-code corrections required by future milestones

The implementation currently needs these corrections over time:
1. replace free-text provenance inference with typed evidence;
2. separate model-basis quality from calibration/validation;
3. make quality scope-aware;
4. audit DMA boundary integrity;
5. retain inlet mapping distance/confidence;
6. tighten logger automatic mapping and exclude weak mappings from calibration metrics;
7. time-align hydraulic model and telemetry comparisons;
8. explicitly label demand-allocation strategy;
9. explicitly label DDA/PDA;
10. move thresholds into engineering policy profiles;
11. support independent per-boundary HGL rather than one global source head;
12. prevent roughness calibration until readiness gates pass.

These are architectural corrections, not permission to implement all of them in one change.

## 29. Required development discipline

For every hydraulic milestone, Copilot SHALL:
1. read this specification before editing;
2. identify which rules the milestone touches;
3. state any proposed deviation before coding;
4. preserve source-data provenance;
5. add deterministic tests for new engineering logic;
6. test both positive and blocking/uncertain cases;
7. verify AI cannot override deterministic classifications;
8. report model-basis impact explicitly;
9. stop before commit/deploy when requested;
10. never quietly broaden scope into calibration, optimization or mutation.

When this specification conflicts with convenience, legacy demo behavior, or an AI suggestion, **this specification wins unless the human owner explicitly changes it**.

## 30. Research basis

This specification is informed by:
- US EPA, EPANET 2.2 User Manual and toolkit documentation;
- US EPA guidance on water-distribution model development, calibration and validation;
- Walski/AWWA hydraulic model calibration literature, including stressed-condition/fire-flow calibration principles;
- World Bank guidance on district metered areas, hydraulic isolation, inlet metering and pressure management;
- peer-reviewed DMA partitioning/design literature using hydraulic constraints, boundary valves and supply points;
- recent residual-analysis literature highlighting compensation between elevation and hydraulic-resistance errors.

The implementation must remain deterministic and conservative even when research suggests probabilistic or optimization techniques. Those may be added only behind explicit engineering controls and validation.

## 31. Governing principle

Aqua's purpose is to let a user with limited hydraulic-modelling expertise ask the right question, have deterministic engineering tools evaluate it, understand what the evidence does and does not support, and know the safest/highest-value next check.

> **AI interprets. Deterministic engineering decides. Evidence controls confidence.**
