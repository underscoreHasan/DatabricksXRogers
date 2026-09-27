import { isCalendarDate } from "../../../lib/date.ts";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function GET(request: Request): Response {
  const dates = new URL(request.url).searchParams.getAll("date");
  if (dates.length !== 1 || !isCalendarDate(dates[0])) {
    return Response.json({ error: "Provide one valid date as YYYY-MM-DD." }, { status: 400 });
  }

  const date = dates[0];
  // UTC arithmetic preserves the supplied calendar date in every server timezone.
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return Response.json({
    date,
    dayOfWeek: WEEKDAYS[weekday],
    dayOfWeekNumber: weekday === 0 ? 7 : weekday,
  });
}
