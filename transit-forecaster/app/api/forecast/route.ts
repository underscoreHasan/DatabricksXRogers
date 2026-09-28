import { createForecastHandler } from "../../../lib/forecast-handler.ts";

import { createForecastDayHandler } from "../../../lib/forecast-day.ts";

export const runtime = "nodejs";
export const POST = createForecastHandler();
export const GET = createForecastDayHandler();
