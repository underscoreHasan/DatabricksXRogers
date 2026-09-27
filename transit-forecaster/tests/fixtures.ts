export function fixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    type: "event",
    test: false,
    name: "Example concert",
    url: "https://www.ticketmaster.ca/example/event/1",
    dates: {
      start: { dateTime: "2026-10-11T02:00:00Z", dateTBD: false, dateTBA: false, timeTBA: false, noSpecificTime: false },
      status: { code: "onsale" },
    },
    classifications: [{ segment: { name: "Music" }, genre: { name: "Rock" } }],
    _embedded: { venues: [venue()] },
    ...overrides,
  };
}

export function venue(name = "Rogers Arena", overrides: Record<string, unknown> = {}) {
  return { id: "venue-1", name, city: { name: "Vancouver" }, state: { stateCode: "BC" }, country: { countryCode: "CA" }, ...overrides };
}

export function page(events: unknown[], number = 0, totalPages = 1) {
  return Response.json({ _embedded: { events }, page: { size: totalPages > 1 ? Math.max(1, events.length) : 100, totalElements: events.length * totalPages, number, totalPages } });
}
