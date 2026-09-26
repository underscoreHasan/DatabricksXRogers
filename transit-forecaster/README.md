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
