# Central project persistence

## Ownership model

- Cloudflare D1 is the authoritative project index and metadata/state database.
- Cloudflare R2 is the authoritative store for source packages and large normalized payloads.
- IndexedDB (`AquaIntelligenceDB`) is a revisioned local cache and active-project preference only.

The browser never reports a non-demo project as synchronized until the R2 write and revision-checked D1 write both succeed. A successful cloud write is followed by a best-effort IndexedDB cache update.

## D1 schema

Migration: `migrations/0001_projects.sql`

The `projects` table stores:

- identity: `id`, `name`, `utility`
- lifecycle: `created_at`, `updated_at`, `status`, `version`
- coordinate metadata: `source_crs`, `normalized_crs`
- source metadata: `source_filename`, `provenance`
- R2 references: `r2_objects`
- model index: `layer_inventory`
- DMA state: `logical_dmas`, `dma_feature_mappings`, `dma_styles`
- telemetry asset definitions: `telemetry_definitions`

JSON columns contain compact state only. GIS features, telemetry readings, ZIP/SHP binaries, and complete project snapshots are excluded from D1.

## R2 object structure

```text
projects/{project-id}/versions/{revision}/
  source/{original-filename}
  normalized/project.json
  telemetry/{source-filename}
  hydraulics/{future-model-file}
```

Each update writes a new normalized snapshot. D1 atomically advances the project revision and normalized object reference only when the expected prior revision still matches.

## Project API

- `GET /api/projects`: D1 project index.
- `GET /api/projects/:id`: detailed D1 metadata/state.
- `POST /api/projects`: multipart create with `project`, required `source`, and optional repeated `telemetry` files.
- `PUT /api/projects/:id`: revision-checked project snapshot and metadata update.
- `GET /api/projects/:id/data`: current normalized payload from R2.

The combined `POST /api/projects` endpoint owns initial source upload, so a separate source endpoint is not required.

Mutation requests require one of:

- a Cloudflare Access identity in `CF-Access-Authenticated-User-Email`, optionally restricted by `AQUA_ALLOWED_WRITERS`; or
- `Authorization: Bearer` matching the `AQUA_PROJECT_WRITE_TOKEN` secret.

`AQUA_ALLOW_LOCAL_WRITES=true` is only for local Workers/Pages development.

Reads are public by default so a fresh browser can discover production projects. Set `AQUA_REQUIRE_READ_AUTH=true` to require Cloudflare Access identity (or `AQUA_PROJECT_READ_TOKEN`) for project index, metadata, and payload reads.

## Startup and offline behavior

1. The cockpit requests `GET /api/projects` before populating the selector.
2. A cached record is used only when its `cloudRevision` equals the D1 `version`.
3. Missing or stale records are loaded from `GET /api/projects/:id/data` and recached.
4. If the central index is unavailable, cached records remain usable and the UI displays `Offline / cached`.
5. Failed updates to an already synchronized project are cached as `pending` against their unchanged base revision and labeled `Not synchronized`.
6. Pending changes retry when that same cloud revision is reopened online. They cannot overwrite a newer revision.
7. A stale browser update receives `409 Project revision conflict`; the UI offers to reload the cloud revision instead of repeatedly sending the stale update.

An initial import still requires its original source `File` for retry. If that first cloud transaction fails, the project remains open in the current session with Retry available, but it cannot be reconstructed from a large source binary after a browser restart.

Built-in demonstration projects are marked `localOnly` and remain in IndexedDB.

## Cloudflare setup after review

1. Copy `wrangler.toml.example` to `wrangler.toml` and enter the created D1 database ID and writer policy.
2. Create D1 database `aqua-projects` and R2 bucket `aqua-projects`.
3. Apply `migrations/0001_projects.sql` to D1.
4. Bind D1 as `AQUA_DB` and R2 as `AQUA_PROJECTS` to the Pages project.
5. Configure Cloudflare Access for project writers, or add `AQUA_PROJECT_WRITE_TOKEN` as an encrypted secret.
6. Deploy only after review, then perform the Lambay migration below.

## Lambay migration

Export the already validated local Lambay record from the browser console:

```js
copy(JSON.stringify(AquaProjectPersistence.exportActive()))
```

Save that JSON outside the deployed static tree, then run after the reviewed API is deployed:

```powershell
$env:AQUA_PROJECT_WRITE_TOKEN = "<secret>"
node scripts/migrate-lambay.mjs `
  --origin https://koen.evergloss.app `
  --snapshot C:\secure\lambay-project.json `
  --source "C:\Users\Edward lim\Downloads\Lambay Island(2).zip" `
  --telemetry-dir projects\lambay-island\demo
```

The script refuses to overwrite an existing `lambay-island` record and validates before upload:

- 3,165 pipes, 3,025 meters, 272 valves, 86 hydrants
- 8 source GIS DMA polygons and 4 logical DMAs
- 8 source-feature mappings and 4 DMA style records
- 12 pressure loggers and 4 DMA inlet meters

## Production validation gate

After migration, verify on `https://koen.evergloss.app/cockpit/`:

1. D1 contains `lambay-island` revision 1 and the expected metadata/state.
2. Every object referenced by `r2_objects` exists in R2.
3. Clear IndexedDB and reload; `Lambay Island` still appears in the selector.
4. Open Lambay and verify all GIS/telemetry counts and DMA styles.
5. Repeat in a separate incognito browser profile.
6. Change one DMA style, reopen from the second profile, and verify the new revision/style.

This validation requires a reviewed production deployment and migration; it cannot be completed against the current static production build.