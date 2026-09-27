import { setTimeout as delay } from "node:timers/promises";
import { DURATION_HOURS, VENUES, isCalendarDate, localDate, normalizeName } from "./event-policy.ts";
import type { EventLookup, MainEvent } from "./event-policy.ts";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const venuePriority = new Map(VENUES.flatMap((venue, index) =>
  [venue.name, ...venue.aliases].map((name) => [normalizeName(name), index] as const)));

function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !isCalendarDate(value.slice(0, 10))) return NaN;
  return Date.parse(value);
}

function isAddOn(event: JsonObject): boolean {
  const ancillary = /^(?:parking(?: pass(?:es)?)?|merchandise|vip(?: packages?| upgrades?)?|suites?|upsell|ancillary|fast lane(?: pass)?|club access)$/i;
  const classifications = Array.isArray(event.classifications) ? event.classifications : [];
  if (classifications.some((entry) => ["segment", "genre", "subGenre", "type", "subType"].some((key) => ancillary.test(text(object(object(entry)[key]).name))))) return true;
  // Restrict title matching to ticket products, rather than words in artist names.
  return /^(?:parking|merchandise|vip upgrade|suite rental)\s*(?:[-:–—]|$)|\b(?:parking (?:pass|only)|vip upgrade|merchandise package|suite rental|fast lane pass|early entry upgrade)\b/i.test(text(event.name));
}

type Candidate = { id: string; priority: number; start: number; event: MainEvent };

export function selectEvent(records: unknown[], date: string): { event: MainEvent | null; malformed: boolean } {
  const candidates: Candidate[] = [];
  let malformed = false;
  for (const entry of records) {
    const raw = object(entry);
    if (!Object.keys(raw).length) { malformed = true; continue; }
    if (raw.test === true || (raw.type !== undefined && raw.type !== "event")) continue;
    const name = text(raw.name);
    const id = text(raw.id);
    if (!name || !id) { malformed = true; continue; }
    const dates = object(raw.dates);
    const start = object(dates.start);
    const status = text(object(dates.status).code);
    if (!status) { malformed = true; continue; }
    if (!["onsale", "offsale", "rescheduled"].includes(status)) continue;
    if (["dateTBD", "dateTBA", "timeTBA", "noSpecificTime"].some((flag) => start[flag] === true)) continue;
    if (isAddOn(raw)) continue;

    const venues = object(raw._embedded).venues;
    if (!Array.isArray(venues) || !venues.length) { malformed = true; continue; }
    let priority = Infinity;
    for (const item of venues) {
      const venue = object(item);
      const venueName = text(venue.name);
      if (!venueName) { malformed = true; continue; }
      const index = venuePriority.get(normalizeName(venueName));
      if (index === undefined) continue;
      const city = text(object(venue.city).name);
      const state = text(object(venue.state).stateCode);
      const country = text(object(venue.country).countryCode);
      if (!city || !state || !country) { malformed = true; continue; }
      if (normalizeName(city) === "vancouver" && state.toUpperCase() === "BC" && country.toUpperCase() === "CA") priority = Math.min(priority, index);
    }
    if (!Number.isFinite(priority)) continue;
    const startMs = timestamp(start.dateTime);
    let sourceUrl: URL;
    try { sourceUrl = new URL(text(raw.url)); }
    catch { malformed = true; continue; }
    if (!Number.isFinite(startMs) || !["http:", "https:"].includes(sourceUrl.protocol) || sourceUrl.username || sourceUrl.password) { malformed = true; continue; }

    const size = VENUES[priority].size;
    const end = object(dates.end);
    const providerEnd = timestamp(end.dateTime);
    const confirmedEnd = Number.isFinite(providerEnd) && providerEnd > startMs && end.approximate !== true && end.noSpecificTime !== true;
    const endMs = confirmedEnd ? providerEnd : startMs + DURATION_HOURS[size] * 60 * 60 * 1000;
    // Compare local calendar days; subtracting 1ms makes the interval half-open.
    // This handles Vancouver's timezone/DST without hardcoding UTC offsets.
    if (localDate(new Date(startMs)) > date || localDate(new Date(endMs - 1)) < date) continue;
    candidates.push({ id, priority, start: startMs, event: {
      name, startTime: new Date(startMs).toISOString(), endTime: new Date(endMs).toISOString(),
      endTimeEstimated: !confirmedEnd, size, sourceUrl: sourceUrl.toString(),
    } });
  }

  const sizes = { large: 0, medium: 1, small: 2 };
  const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  candidates.sort((a, b) => sizes[a.event.size] - sizes[b.event.size] || a.priority - b.priority || a.start - b.start || compareText(a.id, b.id) || compareText(a.event.name, b.event.name));
  const ids = new Set<string>();
  const equivalents = new Set<string>();
  const unique = candidates.filter(({ id, priority, start, event }) => {
    const key = JSON.stringify([normalizeName(event.name), priority, start]);
    if (ids.has(id) || equivalents.has(key)) return false;
    ids.add(id);
    equivalents.add(key);
    return true;
  });
  return { event: unique[0]?.event ?? null, malformed };
}


type LookupOptions = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  pageDelayMs?: number;
};

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_DATES = 128;
const nonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

export function createEventLookup({ apiKey, fetchImpl = fetch, now = Date.now, timeoutMs = 10_000, pageDelayMs = 500 }: LookupOptions): (date: string) => Promise<EventLookup> {
  const cache = new Map<string, { expires: number; result: EventLookup }>();
  const pending = new Map<string, Promise<EventLookup>>();

  async function request(date: string): Promise<EventLookup> {
    const unavailable: EventLookup = { date, lookupStatus: "unavailable", hasHighAttendanceEvent: null, event: null };
    if (!apiKey.trim()) return unavailable;
    const previousDay = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const records: unknown[] = [];
    let receivedPages = 0;
    let complete = false;
    let expectedPage: { totalElements: number; totalPages: number; size: number } | undefined;
    try {
      for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
        if (pageIndex > 0) await delay(pageDelayMs, undefined, { signal: controller.signal });
        controller.signal.throwIfAborted();
        const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
        url.search = new URLSearchParams({
          apikey: apiKey.trim(), city: "Vancouver", stateCode: "BC", countryCode: "CA",
          localStartEndDateTime: `${previousDay}T00:00:00,${date}T23:59:59`,
          includeTBA: "no", includeTBD: "no", includeTest: "no", sort: "date,asc",
          size: String(PAGE_SIZE), page: String(pageIndex),
        }).toString();
        const response = await fetchImpl(url, { signal: controller.signal, cache: "no-store", redirect: "error" });
        if (!response.ok) break;
        const body = object(await response.json());
        const pagination = object(body.page);
        const embeddedEvents = object(body._embedded).events;
        // Ticketmaster omits _embedded for a truly empty catalog.
        const events = embeddedEvents === undefined && body._embedded === undefined && pagination.totalElements === 0 ? [] : embeddedEvents;
        if (!Array.isArray(events)) break;
        records.push(...events);
        receivedPages++;
        const { number, size, totalPages, totalElements } = pagination;
        if (number !== pageIndex || !nonNegativeInteger(size) || size === 0 || !nonNegativeInteger(totalPages) || !nonNegativeInteger(totalElements) || totalElements < events.length || events.length > size || (totalPages === 0 && totalElements !== 0) || (totalPages > 0 && pageIndex >= totalPages)) break;
        const calculatedPages = Math.ceil(totalElements / size);
        if (totalPages !== calculatedPages && !(totalElements === 0 && totalPages === 1)) break;
        if (expectedPage && (totalElements !== expectedPage.totalElements || totalPages !== expectedPage.totalPages || size !== expectedPage.size)) break;
        expectedPage ??= { totalElements, totalPages, size };
        // Truncated pages or a changing catalog cannot establish a negative.
        if (events.length !== Math.min(size, Math.max(0, totalElements - pageIndex * size))) break;
        if (pageIndex + 1 >= totalPages) {
          complete = records.length === totalElements;
          break;
        }
      }
    } catch {
      // Network/JSON/timeout exceptions can contain the credential-bearing URL.
      // Return a safe status without logging or forwarding provider errors.
    } finally {
      clearTimeout(timer);
    }
    if (receivedPages === 0) return unavailable;
    const { event, malformed } = selectEvent(records, date);
    const lookupStatus = complete && !malformed ? "ok" : "partial";
    const highAttendance = event !== null && event.size !== "small";
    return { date, lookupStatus, event, hasHighAttendanceEvent: highAttendance ? true : lookupStatus === "ok" ? false : null };
  }

  return async (date) => {
    const cached = cache.get(date);
    if (cached && cached.expires > now()) return cached.result;
    cache.delete(date);
    const existing = pending.get(date);
    if (existing) return existing;
    const task = request(date);
    pending.set(date, task);
    try {
      const result = await task;
      if (result.lookupStatus === "ok") {
        cache.set(date, { expires: now() + CACHE_TTL_MS, result });
        if (cache.size > CACHE_MAX_DATES) cache.delete(cache.keys().next().value!);
      }
      return result;
    } finally {
      pending.delete(date);
    }
  };
}
