import assert from "node:assert/strict";
import { test } from "node:test";
import { createForecastDayHandler } from "../lib/forecast-day.ts";

const date = "2026-10-03";
const clock = (i: number) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
function predictions() {
  return Array.from({ length: 48 }, (_, i) => ({ date, clock: clock(i), slot_start: `${date}T${clock(i)}:00`,
    volume_p50: 100 + i, dwell_p50: 20, usual_volume: 90, model: "month_ahead", confidence: "medium" }));
}
function typicalPredictions() {
  return predictions().map(row => ({ ...row, volume_p50: 200, dwell_p50: 35, usual_volume: 999, usual_dwell: 999 }));
}
function providers() {
  return {
    weather: async () => Response.json({ date, weather: Array.from({ length: 48 }, (_, i) => ({
      time_local: `${date}T${clock(i)}:00-07:00`, rain: i === 36, temp_c: 14, precip_mm: .5, rain_mm: .2,
    })) }),
    events: async () => Response.json({ date, lookupStatus: "ok", hasHighAttendanceEvent: true, event: {
      name: "Concert", startTime: "2026-10-04T01:15:00Z", endTime: "2026-10-04T02:00:00Z", size: "large", endTimeEstimated: true,
    } }),
    holiday: async () => Response.json({ date, isHoliday: true }),
    dayOfWeek: async () => Response.json({ date, dayOfWeek: "Saturday", dayOfWeekNumber: 6 }),
  };
}
function handler(options: Parameters<typeof createForecastDayHandler>[0] = {}) {
  return createForecastDayHandler({ providers: providers(),
    invoke: async () => Response.json({ predictions: predictions() }),
    invokeTypical: async () => Response.json({ predictions: typicalPredictions() }), ...options });
}
const request = (query = `?date=${date}`) => new Request(`http://localhost/api/forecast${query}`);

test("GET prefers the trained usual volume and uses the dummy only for missing baseline dwell", async () => {
  const GET = handler({ invoke: async body => {
    const { dataframe_records: rows } = body;
    assert.equal(rows.length, 48);
    assert.equal(rows[36].slot_start, "2026-10-03T18:00:00");
    assert.equal(rows[36].rain, true);
    assert.equal(rows[36].temp_c, 14);
    assert.deepEqual(rows[35].event_ids, ["holiday"]);
    assert.deepEqual(rows[36].event_ids, ["holiday", "large_ticketmaster"]);
    assert.deepEqual(rows[37].event_ids, ["holiday", "large_ticketmaster"]);
    assert.deepEqual(rows[38].event_ids, ["holiday"]);
    return Response.json({ predictions: predictions().reverse() });
  }, invokeTypical: async body => {
    assert.deepEqual(body, { dataframe_records: [{ date }] });
    return Response.json({ predictions: typicalPredictions().reverse() });
  } });
  const response = await GET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.selectedDay[36], { time: "18:00", volume: 136, dwellTime: 20 });
  assert.deepEqual(body.typicalDay[36], { time: "18:00", volume: 90, dwellTime: 35 });
  assert.deepEqual(body.baselineSources, { volume: "trained", dwell: "dummy" });
  assert.equal(body.context.dayOfWeek.dayOfWeek, "Saturday");
  assert.equal(body.demo, false);
});

test("GET rejects missing, duplicate and invalid dates before context or either model call", async () => {
  const unexpected = async () => { assert.fail("No call expected"); };
  const GET = handler({ providers: { weather: unexpected, events: unexpected, holiday: unexpected, dayOfWeek: unexpected }, invoke: unexpected, invokeTypical: unexpected });
  for (const query of ["", "?date=2026-02-30", "?date=2026-10-03&date=2026-10-04"]) {
    assert.equal((await GET(request(query))).status, 400);
  }
});

test("failed context omits overrides while retaining successful Databricks projections", async () => {
  const unavailable = async () => Response.json({ error: "Unavailable" }, { status: 503 });
  const GET = handler({ providers: { weather: unavailable, events: unavailable, holiday: unavailable, dayOfWeek: unavailable }, invoke: async body => {
    assert.deepEqual(body.dataframe_records[0], { date, slot_start: "2026-10-03T00:00:00" });
    return Response.json({ predictions: predictions() });
  } });
  const response = await GET(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.context.weather, null);
  assert.equal(body.context.holiday, null);
  assert.equal(body.demo, false);
  assert.equal(body.typicalDay[0].dwellTime, 35);
});

test("invalid or failed predictions leave only that projection unavailable", async () => {
  const failures = [
    async () => Response.json({ error: "Unavailable" }, { status: 503 }),
    async () => { throw new Error("Connection failed"); },
    ...[[], predictions().slice(1), [...predictions().slice(1), predictions()[1]], predictions().map(row => ({ ...row, date: "2026-10-04" }))]
      .map(rows => async () => Response.json({ predictions: rows })),
  ];
  for (const failed of failures) {
    for (const name of ["selectedDay", "typicalDay"] as const) {
      const GET = handler(name === "selectedDay" ? { invoke: failed } : {
        invoke: async () => Response.json({ predictions: predictions().map(row => ({ ...row, usual_volume: null })) }),
        invokeTypical: failed,
      });
      const response = await GET(request());
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body[name], null);
      assert.equal(body[name === "selectedDay" ? "typicalDay" : "selectedDay"].length, 48);
      assert.equal(typeof body.projectionErrors[name], "string");
    }
  }
});

test("GET returns unavailable when both endpoints fail", async () => {
  const failed = async () => Response.json({ error: "Serving unavailable" }, { status: 503 });
  const response = await handler({ invoke: failed, invokeTypical: failed })(request());
  assert.equal(response.status, 503);
});

test("GET keeps real zeroes and leaves absent numeric metrics for the frontend fallback", async () => {
  const response = await handler({
    invoke: async () => Response.json({ predictions: predictions().map(row => ({ ...row, usual_volume: null })) }),
    invokeTypical: async () => Response.json({ predictions: typicalPredictions().map(row => ({ ...row, volume_p50: 0, dwell_p50: null })) }),
  })(request());
  const body = await response.json();
  assert.deepEqual(body.typicalDay[0], { time: "00:00", volume: 0, dwellTime: null });
});


test("a complete trained baseline survives a failed dummy endpoint and preserves real zeroes", async () => {
  const response = await handler({
    invoke: async () => Response.json({ predictions: predictions().map(row => ({ ...row, usual_volume: 0, usual_dwell: 0 })) }),
    invokeTypical: async () => Response.json({ error: "Unavailable" }, { status: 503 }),
  })(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.typicalDay[0], { time: "00:00", volume: 0, dwellTime: 0 });
  assert.deepEqual(body.baselineSources, { volume: "trained", dwell: "trained" });
  assert.equal(body.projectionErrors.typicalDay, undefined);
});

test("dummy volume is used only when the trained baseline volume is unavailable", async () => {
  const response = await handler({ invoke: async () => Response.json({ predictions: predictions().map(row => ({ ...row, usual_volume: null })) }) })(request());
  const body = await response.json();
  assert.equal(body.typicalDay[0].volume, 200);
  assert.deepEqual(body.baselineSources, { volume: "dummy", dwell: "dummy" });
  assert.equal(body.selectedDay[0].volume, 100);
});
