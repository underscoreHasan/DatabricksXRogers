# Transit Forecaster

Minimal hackathon starter: React frontend, Next.js API, TypeScript.

## Run

Use Node.js 24 and npm. From this directory:

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). **Check backend** calls `GET /api/health`.

- `app/page.tsx` — frontend
- `app/api/health/route.ts` — backend
- `app/globals.css` — styles

Production: `npm run build`, then `npm start`.

# Setup shadcn/ui components

Drop `components/transitpulse/` and `app/transitpulse/` into your existing
Next.js app (App Router). Assumes shadcn/ui is already initialized
(`npx shadcn init`), so `@/lib/utils` and `components.json` already exist.

## 1. Install dependencies

```bash
npm install recharts date-fns
```

## 2. Add the required shadcn components

```bash
npx shadcn@latest add card badge button popover calendar progress
```

## Notes

- All data in `data.ts` is synthetic (deterministic per date, via a seeded
  PRNG) — swap `getDayInsights()` for a real API call against your
  cell-tower + external-data backend when that's ready. The shape it
  returns (`DayInsights`) is the contract the components expect.
- `CRUISE_WINDOW` / `EVENT_WINDOW` are hardcoded hour ranges for the demo.
  In production these should come from the actual cruise/event schedule
  data per date, with per-event start/end times.
- The chart's hover tooltip *is* the scrub interaction — Recharts already
  gives you the vertical cursor line and per-point readout for free, so
  there's no custom drag logic to maintain.
- Dark mode: components use shadcn's theme tokens (`bg-card`,
  `text-muted-foreground`, etc.), so they'll follow whatever
  light/dark setup your app already has via `next-themes` or the `dark`
  class on `<html>`.

