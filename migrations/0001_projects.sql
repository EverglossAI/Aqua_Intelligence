CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  utility TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_crs TEXT NOT NULL,
  normalized_crs TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source_filename TEXT NOT NULL DEFAULT '',
  r2_objects TEXT NOT NULL,
  layer_inventory TEXT NOT NULL,
  logical_dmas TEXT NOT NULL,
  dma_feature_mappings TEXT NOT NULL,
  dma_styles TEXT NOT NULL,
  telemetry_definitions TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  provenance TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS projects_updated_at_idx ON projects(updated_at DESC);