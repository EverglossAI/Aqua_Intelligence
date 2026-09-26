CREATE TABLE IF NOT EXISTS acoustic_sensors (
  project_id TEXT NOT NULL,
  sensor_id TEXT NOT NULL,
  status TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  matched_pipe_id TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  review_required INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  PRIMARY KEY (project_id, sensor_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS acoustic_sensors_project_status_idx ON acoustic_sensors(project_id, status);
CREATE INDEX IF NOT EXISTS acoustic_sensors_project_pipe_idx ON acoustic_sensors(project_id, matched_pipe_id);

CREATE TABLE IF NOT EXISTS acoustic_couples (
  project_id TEXT NOT NULL,
  couple_id TEXT NOT NULL,
  sensor_1_id TEXT NOT NULL,
  sensor_2_id TEXT NOT NULL,
  material TEXT,
  last_activity TEXT,
  overlapping INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  PRIMARY KEY (project_id, couple_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS acoustic_couples_project_sensor_1_idx ON acoustic_couples(project_id, sensor_1_id);
CREATE INDEX IF NOT EXISTS acoustic_couples_project_sensor_2_idx ON acoustic_couples(project_id, sensor_2_id);

CREATE TABLE IF NOT EXISTS acoustic_alerts (
  project_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  couple_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  status TEXT NOT NULL,
  state_group TEXT NOT NULL,
  probability REAL,
  detection_date TEXT,
  matched_pipe_id TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  review_required INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  PRIMARY KEY (project_id, alert_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS acoustic_alerts_project_state_idx ON acoustic_alerts(project_id, state_group, status);
CREATE INDEX IF NOT EXISTS acoustic_alerts_project_couple_idx ON acoustic_alerts(project_id, couple_id);
CREATE INDEX IF NOT EXISTS acoustic_alerts_project_pipe_idx ON acoustic_alerts(project_id, matched_pipe_id);