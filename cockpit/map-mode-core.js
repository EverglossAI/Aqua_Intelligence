function textValues(feature) {
  return Object.entries(feature?.properties || {})
    .filter(([key]) => /^(asset_?type|type|subtype|category|class|description|name)$/i.test(key))
    .map(([, value]) => String(value || "").trim().toLowerCase());
}

export function operationalAssetType(feature) {
  const values = textValues(feature);
  if (values.some(value => /(^|\b)(prv|pressure reducing valve)(\b|$)/.test(value))) return "prv";
  if (values.some(value => /(^|\b)(air valve|air release valve|air vacuum valve|combination air valve)(\b|$)/.test(value))) return "air";
  return null;
}

export function mapModeSummary(project = {}) {
  const features = (project.layers || []).flatMap(layer => (layer.geojson?.features || []).map(feature => ({ layer, feature })));
  const classified = features.reduce((result, item) => {
    const type = operationalAssetType(item.feature);
    if (type) result[type].push(item);
    return result;
  }, { prv: [], air: [] });
  const topology = project.hydraulicTopology || project.topology || null;
  const sensors = project.acousticSensor || [];
  const couples = project.acousticCouple || [];
  const alerts = project.acousticAlert || [];
  const logicalDmas = project.logicalDmas || project.lambayDemo?.logicalDmas || [];
  return {
    inspect: { enabled: true, label: "Inspect", detail: "Selectable network and operational assets" },
    topology: { enabled: Boolean(topology?.nodes?.length), count: topology?.nodes?.length || 0, topology, label: "Topology", detail: topology?.nodes?.length ? `${topology.nodes.length} nodes · ${topology.edges?.length || 0} edges · ${Array.isArray(topology.components) ? topology.components.length : topology.components || 0} components` : "No retained topology graph" },
    dma: { enabled: logicalDmas.length > 0, count: logicalDmas.length, label: "DMA", detail: `${logicalDmas.length} logical DMA${logicalDmas.length === 1 ? "" : "s"}` },
    acoustic: { enabled: sensors.length > 0, count: sensors.length, label: "Acoustic", detail: `${sensors.length} sensors · ${couples.length} couples · ${alerts.filter(alert => alert.stateGroup === "active").length} active alerts · ${alerts.filter(alert => alert.stateGroup === "historical").length} historical` },
    prv: { enabled: classified.prv.length > 0, count: classified.prv.length, assets: classified.prv, label: "PRV", detail: classified.prv.length ? `${classified.prv.length} positively identified PRV${classified.prv.length === 1 ? "" : "s"}` : "No positively identified PRV assets" },
    air: { enabled: classified.air.length > 0, count: classified.air.length, assets: classified.air, label: "Air valve", detail: classified.air.length ? `${classified.air.length} positively identified air valve${classified.air.length === 1 ? "" : "s"}` : "No positively identified air-valve assets" }
  };
}

if (typeof window !== "undefined") window.AquaMapModeCore = { mapModeSummary, operationalAssetType };