const DEFAULT_ENDPOINT = "waterfront-crowd-forecast";

function host(): string {
  return (process.env.DATABRICKS_HOST ?? "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function token(): string {
  return (process.env.DATABRICKS_TOKEN ?? "").trim();
}

function endpoint(): string {
  return (process.env.DATABRICKS_SERVING_ENDPOINT ?? DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT;
}

export function servingConfigured(): boolean {
  return Boolean(host() && token());
}

export async function invokeForecast(body: unknown, fetchImpl: typeof fetch = fetch, servingEndpoint = endpoint()): Promise<Response> {
  if (!servingConfigured()) {
    return Response.json({ error: "DATABRICKS_TOKEN is not configured on the server." }, { status: 503 });
  }
  const url = `https://${host()}/serving-endpoints/${encodeURIComponent(servingEndpoint)}/invocations`;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let payload: unknown = text;
    try { payload = JSON.parse(text); } catch { /* keep raw text */ }
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : text || `Databricks serving returned ${response.status}.`;
      const status = response.status === 400 || /missing date|dataframe_records|must be/i.test(message) ? 400
        : response.status === 401 || response.status === 403 ? 503
        : response.status >= 500 ? 503
        : response.status;
      return Response.json({ error: message }, { status });
    }
    if (!payload || typeof payload !== "object" || !("predictions" in payload) || !Array.isArray((payload as { predictions: unknown }).predictions)) {
      return Response.json({ error: "Databricks serving returned an unexpected payload." }, { status: 503 });
    }
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Databricks serving is unavailable." }, { status: 503 });
  }
}

/** Typical weekday baseline uses its own endpoint and the same serving contract. */
export function invokeTypicalForecast(body: unknown, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const name = (process.env.DATABRICKS_TYPICAL_SERVING_ENDPOINT ?? "").trim() || "waterfront-crowd-forecast-dummy";
  return invokeForecast(body, fetchImpl, name);
}
