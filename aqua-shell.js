(() => {
  "use strict";

  const STORAGE_KEY = "aqua-cockpit-window-layout-v1";
  const TOP_INSET = 74;
  const DOCK_INSET = 62;
  const windows = new Map();
  let activeWindowId = null;
  let zIndex = 1500;
  let basemap = null;

  const query = (selector, root = document) => root.querySelector(selector);
  const queryAll = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  class WindowManager {
    constructor() {
      this.saved = this.load();
    }

    load() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      } catch (error) {
        console.warn("Aqua window layout could not be loaded", error);
        return {};
      }
    }

    save() {
      const layout = {};
      windows.forEach((entry, id) => {
        layout[id] = {
          left: entry.element.style.left,
          top: entry.element.style.top,
          width: entry.element.style.width,
          height: entry.element.style.height,
          minimized: entry.minimized,
          closed: entry.closed
        };
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
      this.saved = layout;
    }

    registerWindow(id, options = {}) {
      const element = options.element;
      if (!element || windows.has(id)) return windows.get(id) || null;

      element.removeAttribute("style");
      element.classList.remove("float-collapsed");
      element.classList.add("aqua-window");
      element.dataset.windowId = id;
      queryAll(".float-collapse", element).forEach(button => button.remove());

      const header = options.header || query(".panel-head,.copilot-head,.gis-control-head", element);
      if (!header) return null;
      element.classList.remove("left-panel", "right-panel");
      header.classList.add("aqua-window-header");

      const actions = document.createElement("div");
      actions.className = "aqua-window-actions";
      actions.innerHTML = `
        <button type="button" data-window-action="minimize" title="Minimize" aria-label="Minimize ${options.title}">−</button>
        <button type="button" data-window-action="close" title="Close" aria-label="Close ${options.title}">×</button>`;
      header.append(actions);

      document.body.append(element);
      const saved = this.saved[id] || {};
      const defaultLeft = typeof options.left === "function" ? options.left() : options.left;
      element.style.left = saved.left || `${defaultLeft ?? 18}px`;
      element.style.top = saved.top || `${options.top ?? 84}px`;
      element.style.width = saved.width || `${options.width ?? 360}px`;
      element.style.height = saved.height || `${options.height ?? 480}px`;

      const entry = {
        id,
        title: options.title || id,
        shortTitle: options.shortTitle || options.title || id,
        icon: options.icon || "·",
        element,
        header,
        beforeClose: options.beforeClose || null,
        minimized: Boolean(saved.minimized),
        closed: Boolean(saved.closed)
      };
      windows.set(id, entry);
      this.addTaskbarButton(entry);
      this.bind(entry);
      this.clampToViewport(entry);

      if (entry.minimized || entry.closed || options.open === false && !this.saved[id]) {
        if (!this.saved[id] && options.open === false) entry.closed = true;
        element.classList.add("is-hidden");
      } else {
        this.focus(id);
      }
      this.updateTaskbar(entry);
      return entry;
    }

    bind(entry) {
      const { element, header, id } = entry;
      element.addEventListener("pointerdown", () => this.focus(id));
      header.addEventListener("pointerdown", event => {
        if (event.target.closest("button,input,select,textarea,a")) return;
        if (matchMedia("(max-width: 800px)").matches) return;
        this.focus(id);
        const bounds = element.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        header.setPointerCapture?.(event.pointerId);

        const move = pointerEvent => {
          const maxLeft = Math.max(0, innerWidth - bounds.width);
          const maxTop = Math.max(TOP_INSET, innerHeight - DOCK_INSET - bounds.height);
          element.style.left = `${clamp(bounds.left + pointerEvent.clientX - startX, 0, maxLeft)}px`;
          element.style.top = `${clamp(bounds.top + pointerEvent.clientY - startY, TOP_INSET, maxTop)}px`;
        };
        const stop = () => {
          removeEventListener("pointermove", move);
          removeEventListener("pointerup", stop);
          this.save();
        };
        addEventListener("pointermove", move);
        addEventListener("pointerup", stop);
      });

      query('[data-window-action="minimize"]', element).addEventListener("click", () => this.minimize(id));
      query('[data-window-action="close"]', element).addEventListener("click", () => this.close(id));
      new ResizeObserver(() => {
        if (!element.classList.contains("is-hidden")) this.save();
      }).observe(element);
    }

    addTaskbarButton(entry) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.windowId = entry.id;
      button.innerHTML = `<span aria-hidden="true">${entry.icon}</span><b>${entry.shortTitle}</b>`;
      button.title = `Open ${entry.title}`;
      button.addEventListener("click", () => {
        if (entry.minimized || entry.closed || entry.element.classList.contains("is-hidden")) this.restore(entry.id);
        else if (activeWindowId === entry.id) this.minimize(entry.id);
        else this.focus(entry.id);
      });
      query("#aquaDock")?.append(button);

      const menuButton = document.createElement("button");
      menuButton.type = "button";
      menuButton.dataset.toolWindowId = entry.id;
      menuButton.innerHTML = `<span aria-hidden="true">${entry.icon}</span><span><b>${entry.title}</b><small>Open tool</small></span>`;
      menuButton.addEventListener("click", () => {
        this.restore(entry.id);
        query("#aquaToolMenu")?.classList.remove("is-open");
      });
      query("#aquaToolMenuList")?.append(menuButton);
    }

    updateTaskbar(entry) {
      const button = query(`#aquaDock [data-window-id="${entry.id}"]`);
      if (!button) return;
      button.classList.toggle("is-minimized", entry.minimized);
      button.classList.toggle("is-closed", entry.closed);
      button.classList.toggle("is-active", activeWindowId === entry.id && !entry.element.classList.contains("is-hidden"));
      const menuButton = query(`#aquaToolMenu [data-tool-window-id="${entry.id}"]`);
      menuButton?.classList.toggle("is-open", !entry.element.classList.contains("is-hidden"));
    }

    focus(id) {
      const entry = windows.get(id);
      if (!entry || entry.element.classList.contains("is-hidden")) return;
      activeWindowId = id;
      entry.element.style.zIndex = String(++zIndex);
      windows.forEach(item => item.element.classList.toggle("is-focused", item.id === id));
      windows.forEach(item => this.updateTaskbar(item));
    }

    open(id) {
      this.restore(id);
    }

    minimize(id) {
      const entry = windows.get(id);
      if (!entry) return;
      entry.minimized = true;
      entry.closed = false;
      entry.element.classList.add("is-hidden");
      entry.element.classList.remove("is-focused");
      if (activeWindowId === id) activeWindowId = null;
      this.updateTaskbar(entry);
      this.save();
    }

    restore(id) {
      const entry = windows.get(id);
      if (!entry) return;
      entry.minimized = false;
      entry.closed = false;
      entry.element.classList.remove("is-hidden");
      this.clampToViewport(entry);
      this.focus(id);
      this.save();
      window.dispatchEvent(new CustomEvent("aqua:window-restored", { detail: { id } }));
    }

    async close(id) {
      const entry = windows.get(id);
      if (!entry) return;
      if (entry.beforeClose && await entry.beforeClose() === false) return;
      entry.minimized = false;
      entry.closed = true;
      entry.element.classList.add("is-hidden");
      entry.element.classList.remove("is-focused");
      if (activeWindowId === id) activeWindowId = null;
      this.updateTaskbar(entry);
      this.save();
    }

    setBeforeClose(id, callback) {
      const entry = windows.get(id);
      if (entry) entry.beforeClose = callback;
      return Boolean(entry);
    }

    clampToViewport(entry) {
      if (matchMedia("(max-width: 800px)").matches) return;
      const bounds = entry.element.getBoundingClientRect();
      const maxWidth = Math.max(280, innerWidth - 16);
      const maxHeight = Math.max(180, innerHeight - TOP_INSET - DOCK_INSET);
      if (bounds.width > maxWidth) entry.element.style.width = `${maxWidth}px`;
      if (bounds.height > maxHeight) entry.element.style.height = `${maxHeight}px`;
      const adjusted = entry.element.getBoundingClientRect();
      entry.element.style.left = `${clamp(adjusted.left, 0, Math.max(0, innerWidth - adjusted.width))}px`;
      entry.element.style.top = `${clamp(adjusted.top, TOP_INSET, Math.max(TOP_INSET, innerHeight - DOCK_INSET - adjusted.height))}px`;
    }

    clampAll() {
      windows.forEach(entry => this.clampToViewport(entry));
      this.save();
    }
  }

  const windowManager = new WindowManager();

  function makeChrome() {
    const chrome = document.createElement("header");
    chrome.id = "aquaChrome";
    chrome.innerHTML = `
      <div class="aqua-brand"><b>AQUA</b><span>INTELLIGENCE</span></div>
      <div class="aqua-project">
        <div class="aqua-project-context"><small>PROJECT / NETWORK</small><div id="aquaProject"></div></div>
        <button type="button" id="aquaProjectTools" title="Project and data" aria-label="Open project and data tools">+</button>
      </div>
      <div class="aqua-command">
        <span class="aqua-command-mark" aria-hidden="true">›</span>
        <div><small>AQUA COMMAND</small><input id="aquaCommand" type="search" aria-label="Ask Aqua or run a command" aria-keyshortcuts="/" placeholder="Ask the network or run an engineering command..."></div>
        <kbd>/</kbd>
        <button id="aquaRun" type="button">Run</button>
      </div>
      <div class="aqua-map-modes" aria-label="Basemap">
        <button type="button" data-basemap="street" class="is-active">Street</button>
        <button type="button" data-basemap="satellite">Satellite</button>
        <button type="button" data-basemap="terrain">Terrain</button>
      </div>
      <button type="button" class="aqua-tools" id="aquaOpenTools" title="Open tools" aria-label="Open tools"><span aria-hidden="true">⊞</span><b>Tools</b></button>`;
    document.body.append(chrome);
    const guideStack = query(".map-guide-stack");
    if (guideStack) chrome.append(guideStack);

    const dock = document.createElement("nav");
    dock.id = "aquaDock";
    dock.setAttribute("aria-label", "Minimized windows");
    document.body.append(dock);

    const toolMenu = document.createElement("aside");
    toolMenu.id = "aquaToolMenu";
    toolMenu.innerHTML = '<div><small>WORKSPACE TOOLS</small><b>Open a tool</b></div><div id="aquaToolMenuList"></div>';
    document.body.append(toolMenu);

    const projectSelect = query("#projectSelect");
    if (projectSelect) query("#aquaProject").append(projectSelect);
    query("#aquaRun")?.addEventListener("click", () => runCommand(query("#aquaCommand")?.value));
    query("#aquaCommand")?.addEventListener("keydown", event => {
      if (event.key === "Enter") runCommand(event.currentTarget.value);
    });
    query("#aquaProjectTools")?.addEventListener("click", () => windowManager.restore("project"));
    query("#aquaOpenTools")?.addEventListener("click", event => {
      event.stopPropagation();
      query("#aquaToolMenu")?.classList.toggle("is-open");
    });
    document.addEventListener("pointerdown", event => {
      if (!event.target.closest("#aquaToolMenu,#aquaOpenTools")) query("#aquaToolMenu")?.classList.remove("is-open");
    });
    queryAll("[data-basemap]").forEach(button => {
      button.addEventListener("click", () => switchBasemap(button.dataset.basemap, button));
    });
  }

  function makeProjectWindow() {
    const actions = query(".top-actions");
    if (!actions) return;
    const wrapper = document.createElement("section");
    wrapper.className = "panel aqua-project-window";
    wrapper.innerHTML = '<div class="panel-head"><div><small>PROJECT & DATA</small><h2>Workspace setup</h2></div></div><div class="aqua-project-body"></div>';
    const body = query(".aqua-project-body", wrapper);
    [...actions.children].forEach(child => body.append(child));
    windowManager.registerWindow("project", {
      element: wrapper,
      title: "Project & Data",
      shortTitle: "Project",
      icon: "P",
      left: 18,
      top: 84,
      width: 360,
      height: 330,
      open: false
    });
  }

  function registerCockpitWindows() {
    const isMobile = matchMedia("(max-width: 800px)").matches;
    const registrations = [
      ["network", ".left-panel", "Network / DMA Planner", "Network", "N", 18, 84, 350, 620, true],
      ["copilot", ".right-panel", "Aqua AI / Command", "Aqua", "A", () => innerWidth - 390, 84, 370, 560, !isMobile],
      ["analysis", ".analysis-output", "Hydraulic & NRW Analysis", "Analysis", "Σ", () => innerWidth - 760, 105, 720, 440, false],
      ["events", ".intelligence", "Leak Risk & Events", "Risk", "!", () => innerWidth - 430, 130, 400, 390, false],
      ["engineering", ".engineering", "Engineering Advisor", "Advisor", "E", () => innerWidth - 450, 150, 420, 390, false],
      ["data-health", ".data-health", "Data Health", "Data", "D", 70, 150, 340, 280, false],
      ["hydraulics", "#hydraulicsWorkbench", "EPANET Hydraulics", "Hydraulics", "H", () => innerWidth / 2 - 380, 92, 760, 650, false],
      ["acoustics", "#acousticWorkbench", "Acoustic Intelligence", "Acoustics", "S", () => innerWidth / 2 - 360, 105, 720, 620, false],
      ["pressure-analysis", "#pressureAnalysisWorkbench", "Pressure Analysis", "Pressure", "P", () => innerWidth / 2 - 390, 92, 780, 650, false],
      ["comparison", "#comparisonWorkbench", "Compare Monitoring Sources", "Compare", "C", () => innerWidth / 2 - 410, 92, 820, 650, false],
      ["asset-details", "#assetDetailsWorkbench", "Asset Details", "Asset", "i", () => innerWidth - 430, 92, 400, 560, false],
      ["dma-details", "#dmaDetailsWorkbench", "DMA Details", "DMA", "D", 26, 105, 440, 610, false],
      ["elevation-profile", "#elevationProfileWorkbench", "Elevation Profile", "Elevation", "↗", () => innerWidth / 2 - 370, 110, 740, 520, false],
      ["environmental-context", "#environmentalContextWorkbench", "Environmental Context", "Environment", "W", () => innerWidth / 2 - 410, 92, 820, 650, false],
      ["layers", ".gis-control", "Map Layers", "Layers", "L", 30, 125, 300, 430, false]
    ];
    registrations.forEach(([id, selector, title, shortTitle, icon, left, top, width, height, open]) => {
      const element = query(selector);
      if (!element) return;
      windowManager.registerWindow(id, { element, title, shortTitle, icon, left, top, width, height, open });
    });
  }

  function clickControl(id, windowId) {
    const control = query(`#${id}`);
    if (!control) return false;
    control.click();
    if (windowId) windowManager.restore(windowId);
    return true;
  }

  function runCommand(raw) {
    const command = String(raw || "").trim();
    if (!command) return;
    const normalized = command.toLowerCase();
    const projectQuery = window.AquaProjectQueries?.matches(command);
    const requiresProject = projectQuery || /topolog|connect|network graph|disconnected|water balance|non.?revenue|\bnrw\b|real loss|apparent loss|dma|district meter|hydrophone|deploy|leak|fusion|prv|pressure reducing|air valve|air release|vacuum|high point/.test(normalized);
    if (requiresProject && !query("#projectSelect")?.value) {
      windowManager.restore("project");
      query("#aquaCommand")?.focus();
      return;
    }
    if (projectQuery && window.AquaProjectQueries.handle(command)) windowManager.restore("copilot");
    else if (/topolog|connect|network graph|disconnected/.test(normalized)) clickControl("runTopology", "analysis");
    else if (/water balance|non.?revenue|\bnrw\b|real loss|apparent loss/.test(normalized)) clickControl("runWaterBalance", "analysis");
    else if (/dma|district meter/.test(normalized)) clickControl("runDmaPlanner", "analysis");
    else if (/hydrophone|sensor.*deploy|acoustic.*deploy/.test(normalized)) clickControl("runSensorPlanner", "analysis");
    else if (/suspected leak|leak risk|leak priority|fusion|fuse/.test(normalized)) {
      window.AquaLeakRisk?.render();
      windowManager.restore("events");
    }
    else if (/\bprv\b|pressure reducing/.test(normalized)) clickControl("runPrvAdvisor", "analysis");
    else if (/air valve|air release|vacuum|high point/.test(normalized)) clickControl("runAirAdvisor", "analysis");
    else if (/layer|basemap/.test(normalized)) windowManager.restore("layers");
    else if (/hydraulic|epanet/.test(normalized)) windowManager.restore("hydraulics");
    else if (/acoustic|noise/.test(normalized)) windowManager.restore("acoustics");
    else {
      windowManager.restore("copilot");
      const prompt = query("#prompt");
      if (prompt) prompt.value = command;
      query("#askBtn")?.click();
    }
    if (query("#aquaCommand")) query("#aquaCommand").value = "";
  }

  function switchBasemap(type, button) {
    const map = window.aquaMap;
    if (!map || !window.L) return;
    map.eachLayer(layer => {
      if (layer instanceof L.TileLayer) map.removeLayer(layer);
    });
    const definitions = {
      street: ["https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", "&copy; OpenStreetMap contributors", 19],
      satellite: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", "Tiles &copy; Esri", 19],
      terrain: ["https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", "Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap", 17]
    };
    const definition = definitions[type] || definitions.street;
    basemap = L.tileLayer(definition[0], { maxZoom: definition[2], attribution: definition[1] }).addTo(map);
    basemap.bringToBack();
    queryAll("[data-basemap]").forEach(item => item.classList.toggle("is-active", item === button));
  }

  function initShell() {
    document.body.classList.add("aqua-map-first");
    makeChrome();
    makeProjectWindow();
    registerCockpitWindows();
    window.dispatchEvent(new CustomEvent("aqua:windows-ready"));
    switchBasemap("street", query('[data-basemap="street"]'));
    setTimeout(() => window.aquaMap?.invalidateSize(), 50);

    addEventListener("resize", () => {
      windowManager.clampAll();
      window.aquaMap?.invalidateSize();
    });
    addEventListener("keydown", event => {
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.matches("input,textarea,select")) {
        event.preventDefault();
        query("#aquaCommand")?.focus();
        return;
      }
      if (event.key !== "Escape" || !activeWindowId) return;
      if (query(".modal:not(.hidden)")) return;
      windowManager.close(activeWindowId);
    });
  }

  window.AquaWindowManager = windowManager;
  window.addEventListener("load", () => setTimeout(initShell, 220));
})();