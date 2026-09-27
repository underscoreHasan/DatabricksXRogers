import { ForecastValidationError, parseForecastRequest } from "./forecast.ts";
import { invokeForecast } from "./databricks-serving.ts";

type Options = { fetchImpl?: typeof fetch };

export function createForecastHandler({ fetchImpl }: Options = {}) {
  return async function POST(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Request must be a JSON object with dataframe_records." }, { status: 400 });
    }
    try {
      parseForecastRequest(body);
    } catch (error) {
      const message = error instanceof ForecastValidationError ? error.message : "Missing date or not YYYY-MM-DD.";
      return Response.json({ error: message }, { status: 400 });
    }
    return invokeForecast(body, fetchImpl);
  };
}
