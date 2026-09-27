# Databricks x Rogers

The Next.js and React app lives in [transit-forecaster](transit-forecaster/README.md).

```sh
cd transit-forecaster
npm ci
npm run dev
```

The Waterfront training tables are built by a Lakeflow pipeline named **waterfront-model-v1**. Open **Jobs & Pipelines** in the Databricks workspace, or: https://dbc-fff97889-921e.cloud.databricks.com/#joblist/pipelines/055de0d4-5e06-4129-bf3a-eb3d7f3a5151

The refresh job **waterfront-model-v1-refresh** runs that pipeline, then the XGBoost training notebook as the last task.

```sh
databricks bundle deploy
databricks bundle run waterfront_etl
databricks bundle run waterfront_etl_refresh
```

TransLink timetables live in schema `workspace.translink`, not in `databricksxrogers`. Raw Waterfront-only GTFS extracts sit on the volume under `external/translink/gtfs/`. The Lakeflow pipeline **translink-gtfs** builds 30-minute scheduled activity at Waterfront: https://dbc-fff97889-921e.cloud.databricks.com/#joblist/pipelines/bd1889cc-d64b-4d1b-8323-da3de471e1f9

```sh
python pipelines/ingest/translink_snapshots.py
databricks fs mkdir dbfs:/Volumes/workspace/default/databricksxrogers/external/translink/gtfs/snapshots
databricks fs cp --recursive /tmp/translink-gtfs-extract/snapshots dbfs:/Volumes/workspace/default/databricksxrogers/external/translink/gtfs/snapshots
databricks bundle deploy
databricks bundle run translink_gtfs
```

The crowd-forecast dummy is a Unity Catalog model, `workspace.databricksxrogers.waterfront_crowd_forecast`, served at `waterfront-crowd-forecast`. The app calls it through `POST /api/forecast`. Contract: [docs/api/API_CONTRACT.md](docs/api/API_CONTRACT.md).

```sh
databricks bundle deploy
databricks bundle run register_dummy_forecast
```
