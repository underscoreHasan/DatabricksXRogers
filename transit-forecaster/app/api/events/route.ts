import { parseDate } from "../../../lib/event-policy.ts";
import { createEventLookup } from "../../../lib/ticketmaster.ts";

export const runtime = "nodejs";
const apiKey = process.env.TICKETMASTER_API_KEY?.trim() ?? "";
const lookup = createEventLookup({ apiKey });

export async function GET(request: Request): Promise<Response> {
  const date = parseDate(new URL(request.url).searchParams.getAll("date"));
  if (!date) {
    return Response.json({ error: "Provide one valid date as YYYY-MM-DD, today or later in America/Vancouver." }, { status: 400 });
  }
  if (!apiKey) {
    return Response.json({ date, lookupStatus: "unavailable", hasHighAttendanceEvent: null, event: null,
      error: "TICKETMASTER_API_KEY is not configured on the server." }, { status: 503 });
  }
  const result = await lookup(date);
  return Response.json(result, {
    status: result.lookupStatus === "unavailable" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
