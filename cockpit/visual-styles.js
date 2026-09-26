(() => {
  "use strict";

  const STORAGE_KEY = "aqua-visual-styles-v1";
  const DEFAULTS = Object.freeze({
    "network.pipe": "#6f9fb8",
    "network.meter": "#f2c14e",
    "network.valve": "#b58cff",
    "network.hydrant": "#ff7f6d",
    "monitoring.pressure": "#4fb7ff",
    "monitoring.flow": "#43c59e",
    "monitoring.acoustic": "#ffad4d",
    "environmental.rainfall": "#a98bff",
    "environmental.temperature": "#ff6f61",
    "environmental.soilMoisture": "#b88a5a",
    "environmental.et": "#e6c84f",
    "intelligence.priority": "#ff5d72",
    "terrain.elevation": "#39d4c7",
    "engineering.hydraulic": "#e56bde"
  });
  const SOURCE_KEYS = Object.freeze({
    pressure: "monitoring.pressure",
    flow: "monitoring.flow",
    acoustic: "monitoring.acoustic",
    "environment-rainfall": "environmental.rainfall",
    "environment-temperature": "environmental.temperature",
    "environment-soil-moisture": "environmental.soilMoisture",
    "environment-evapotranspiration": "environmental.et",
    elevation: "terrain.elevation",
    hydraulic: "engineering.hydraulic"
  });
  const DEFAULT_VISIBILITY = Object.freeze({ "network.meter": false, "network.valve": false });
  const FALLBACKS = ["#4fb7ff", "#43c59e", "#ffad4d", "#a98bff", "#ff6f61", "#e6c84f", "#39d4c7", "#e56bde"];
  const LABELS = Object.freeze({
    "network.pipe": "Pipe",
    "network.meter": "Meter",
    "network.valve": "Valve",
    "monitoring.pressure": "Pressure logger",
    "monitoring.flow": "DMA inlet meter",
    "monitoring.acoustic": "Acoustic",
    "intelligence.priority": "Priority"
  });
  let custom = load();

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return Object.fromEntries(Object.entries(saved).filter(([key, value]) => key in DEFAULTS && /^#[0-9a-f]{6}$/i.test(value)));
    } catch {
      return {};
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
  }

  function color(key) {
    return custom[key] || DEFAULTS[key] || "#8299ac";
  }

  function visible(key) {
    try {
      const saved = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-visibility`) || "{}");
      return Object.hasOwn(saved, key) ? saved[key] !== false : DEFAULT_VISIBILITY[key] !== false;
    } catch {
      return true;
    }
  }

  function emit(key) {
    window.dispatchEvent(new CustomEvent("aqua:visual-style-changed", { detail: { key, color: color(key), visible: visible(key) } }));
  }

  function setColor(key, value) {
    if (!(key in DEFAULTS) || !/^#[0-9a-f]{6}$/i.test(value)) return false;
    custom[key] = value.toLowerCase();
    save();
    emit(key);
    return true;
  }

  function setVisible(key, value) {
    if (!(key in DEFAULTS)) return false;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-visibility`) || "{}"); } catch {}
    saved[key] = Boolean(value);
    localStorage.setItem(`${STORAGE_KEY}-visibility`, JSON.stringify(saved));
    emit(key);
    return true;
  }

  function reset(key) {
    if (key) delete custom[key];
    else custom = {};
    save();
    if (key) {
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-visibility`) || "{}"); } catch {}
      delete saved[key];
      localStorage.setItem(`${STORAGE_KEY}-visibility`, JSON.stringify(saved));
    } else {
      localStorage.removeItem(`${STORAGE_KEY}-visibility`);
    }
    emit(key || "all");
  }

  function sourceColor(type) {
    return color(SOURCE_KEYS[type] || type);
  }

  function rgb(value) {
    const hex = value.replace("#", "");
    return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
  }

  function distance(left, right) {
    const a = rgb(left);
    const b = rgb(right);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  function comparisonPair(typeA, typeB) {
    const first = sourceColor(typeA);
    let second = sourceColor(typeB);
    if (distance(first, second) < 95) {
      second = FALLBACKS.find(candidate => distance(first, candidate) >= 120 && candidate.toLowerCase() !== first.toLowerCase()) || "#ffffff";
    }
    return { A: first, B: second };
  }

  function applyVisibility(key, value) {
    const networkKind = key.startsWith("network.") ? key.split(".")[1] : null;
    if (networkKind) window.aquaSetProjectLayer?.(networkKind, value, { fit: false });
    const telemetryKind = { "monitoring.pressure": "pressure", "monitoring.flow": "flow" }[key];
    if (telemetryKind) window.AquaLambayDemo?.setLayer?.(telemetryKind, value, { fit: false });
    if (key === "monitoring.acoustic") {
      const control = document.querySelector('[data-acoustic-toggle="sensors"]');
      if (control && control.checked !== value) {
        control.checked = value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    if (key === "intelligence.priority") {
      const control = document.getElementById("showLeakRiskOverlay");
      if (control && control.checked !== value) {
        control.checked = value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }

  function refreshLegend() {
    document.querySelectorAll("[data-style-key]").forEach(item => {
      const key = item.dataset.styleKey;
      item.style.setProperty("--legend-color", color(key));
      item.classList.toggle("is-hidden-layer", !visible(key));
      item.setAttribute("aria-pressed", String(visible(key)));
    });
  }

  function initLegend() {
    const popover = document.getElementById("mapLegendPopover");
    const colorInput = document.getElementById("mapLegendColor");
    const visibilityInput = document.getElementById("mapLegendVisible");
    if (!popover || !colorInput || !visibilityInput) return;
    let activeKey = null;
    document.querySelectorAll(".map-legend-item").forEach(item => item.addEventListener("click", event => {
      const key = item.dataset.styleKey;
      if (event.target.closest(".legend-eye")) {
        setVisible(key, !visible(key));
        applyVisibility(key, visible(key));
        refreshLegend();
        return;
      }
      activeKey = key;
      document.getElementById("mapLegendPopoverTitle").textContent = LABELS[key];
      colorInput.value = color(key);
      visibilityInput.checked = visible(key);
      popover.classList.remove("hidden");
    }));
    colorInput.addEventListener("input", () => { if (activeKey) setColor(activeKey, colorInput.value); });
    visibilityInput.addEventListener("change", () => {
      if (!activeKey) return;
      setVisible(activeKey, visibilityInput.checked);
      applyVisibility(activeKey, visibilityInput.checked);
      refreshLegend();
    });
    document.getElementById("mapLegendResetItem")?.addEventListener("click", () => {
      if (!activeKey) return;
      reset(activeKey);
      colorInput.value = color(activeKey);
      visibilityInput.checked = visible(activeKey);
      applyVisibility(activeKey, visible(activeKey));
      refreshLegend();
    });
    document.getElementById("resetLegendStyles")?.addEventListener("click", () => {
      reset();
      Object.keys(LABELS).forEach(key => applyVisibility(key, visible(key)));
      refreshLegend();
      popover.classList.add("hidden");
    });
    document.addEventListener("pointerdown", event => {
      if (!event.target.closest(".map-legend")) popover.classList.add("hidden");
    });
    refreshLegend();
    setTimeout(() => Object.keys(LABELS).forEach(key => applyVisibility(key, visible(key))), 300);
  }

  window.AquaVisualStyles = { defaults: DEFAULTS, sourceKeys: SOURCE_KEYS, color, visible, setColor, setVisible, reset, sourceColor, comparisonPair };
  window.addEventListener("load", initLegend);
})();
