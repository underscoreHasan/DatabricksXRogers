import { isCalendarDate } from "../../../lib/date.ts";

export async function GET(request: Request): Promise<Response> {
  const dates = new URL(request.url).searchParams.getAll("date");
  if (dates.length !== 1 || !isCalendarDate(dates[0])) {
    return Response.json({ error: "Provide one valid date as YYYY-MM-DD." }, { status: 400 });
  }

  const date = dates[0];
  const year = Number(date.slice(0, 4));
  if (year < 2013 || year > 2038) {
    return Response.json({ error: "Holiday dates are supported from 2013 through 2038." }, { status: 400 });
  }

  try {
    const response = await fetch(`https://canada-holidays.ca/api/v1/provinces/BC?year=${year}&optional=false`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Holiday lookup failed");

    const data = await response.json();
    const holidays: { date: string }[] = data?.province?.holidays;
    if (data?.province?.id !== "BC" || !Array.isArray(holidays) || holidays.length === 0 ||
      !holidays.every((holiday) => typeof holiday?.date === "string" &&
        isCalendarDate(holiday.date) && Number(holiday.date.slice(0, 4)) === year)) {
      throw new Error("Invalid holiday response");
    }

    // Compare calendar dates directly, without server timezone or observed-day shifts.
    return Response.json({ date, isHoliday: holidays.some((holiday) => holiday.date === date) });
  } catch {
    return Response.json({ error: "Holiday lookup is unavailable. Please try again." }, { status: 503 });
  }
}
