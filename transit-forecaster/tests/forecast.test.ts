import assert from "node:assert/strict";
import { test } from "node:test";
import { ForecastValidationError, parseForecastRequest } from "../lib/forecast.ts";

test("accepts a date-only row and slot overrides", () => {
  const body = parseForecastRequest({
    dataframe_records: [
      { date: "2026-09-12" },
      { date: "2026-09-13", slot_start: "2026-09-13T18:07:00+00:00", rain: true, temp_c: 14.5,
        event_ids: ["large_canucks_game"] },
    ],
  });
  assert.equal(body.dataframe_records.length, 2);
});

test("rejects missing payload, empty list, and bad dates", () => {
  const cases: unknown[] = [
    null,
    [],
    {},
    { dataframe_records: [] },
    { dataframe_records: [{ date: "2026-9-12" }] },
    { dataframe_records: [{ date: "2026-02-30" }] },
    { dataframe_records: [{ date: "2026-09-12T00:00:00" }] },
    { dataframe_records: [{ date: 20260912 }] },
  ];
  for (const body of cases) {
    assert.throws(() => parseForecastRequest(body), ForecastValidationError);
  }
});

test("rejects badly typed optional fields", () => {
  assert.throws(() => parseForecastRequest({ dataframe_records: [{ date: "2026-09-13", rain: 1 }] }), /rain must be a boolean/);
  assert.throws(() => parseForecastRequest({ dataframe_records: [{ date: "2026-09-13", temp_c: "warm" }] }), /temp_c/);
  assert.throws(() => parseForecastRequest({ dataframe_records: [{ date: "2026-09-13", event_ids: "large" }] }), /event_ids/);
  assert.throws(() => parseForecastRequest({ dataframe_records: [{ date: "2026-09-13", slot_start: "18:00" }] }), /slot_start/);
});

test("unknown event ids are allowed", () => {
  parseForecastRequest({ dataframe_records: [{ date: "2026-09-13", event_ids: ["community_fair", "large_canucks_game"] }] });
});

test("POST /api/forecast validates before calling Databricks", async () => {
  const { POST } = await import("../app/api/forecast/route.ts");
  const response = await POST(new Request("http://localhost/api/forecast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataframe_records: [{ date: "bad" }] }),
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Missing date or not YYYY-MM-DD/);
});

test("POST /api/forecast forwards a valid body and returns serving predictions", async () => {
  const previousHost = process.env.DATABRICKS_HOST;
  const previousToken = process.env.DATABRICKS_TOKEN;
  process.env.DATABRICKS_HOST = "dbc-fff97889-921e.cloud.databricks.com";
  process.env.DATABRICKS_TOKEN = "test-token";
  try {
    const { createForecastHandler } = await import("../lib/forecast-handler.ts");
    const payload = { predictions: [{ date: "2026-09-12", slot_start: "2026-09-12T00:00:00", clock: "00:00" }] };
    const POST = createForecastHandler({ fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://dbc-fff97889-921e.cloud.databricks.com/serving-endpoints/waterfront-crowd-forecast/invocations");
      assert.equal(init?.headers && new Headers(init.headers).get("Authorization"), "Bearer test-token");
      assert.deepEqual(JSON.parse(String(init?.body)), { dataframe_records: [{ date: "2026-09-12" }] });
      return Response.json(payload);
    } });
    const response = await POST(new Request("http://localhost/api/forecast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataframe_records: [{ date: "2026-09-12" }] }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), payload);
  } finally {
    if (previousHost !== undefined) process.env.DATABRICKS_HOST = previousHost;
    else delete process.env.DATABRICKS_HOST;
    if (previousToken !== undefined) process.env.DATABRICKS_TOKEN = previousToken;
    else delete process.env.DATABRICKS_TOKEN;
  }
});

test("POST /api/forecast returns 503 when serving is not configured", async () => {
  const previousHost = process.env.DATABRICKS_HOST;
  const previousToken = process.env.DATABRICKS_TOKEN;
  delete process.env.DATABRICKS_HOST;
  delete process.env.DATABRICKS_TOKEN;
  try {
    const { createForecastHandler } = await import("../lib/forecast-handler.ts");
    const response = await createForecastHandler()(new Request("http://localhost/api/forecast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataframe_records: [{ date: "2026-09-12" }] }),
    }));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /DATABRICKS_TOKEN/);
  } finally {
    if (previousHost !== undefined) process.env.DATABRICKS_HOST = previousHost;
    else delete process.env.DATABRICKS_HOST;
    if (previousToken !== undefined) process.env.DATABRICKS_TOKEN = previousToken;
    else delete process.env.DATABRICKS_TOKEN;
  }
});
