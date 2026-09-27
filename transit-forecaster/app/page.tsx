"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { MapPin } from "lucide-react";

import { DatePicker } from "@/components/transitpulse/DatePicker";
import { ActivityIndexCard } from "@/components/transitpulse/ActivityIndexCard";
import { StatsRow } from "@/components/transitpulse/StatsRow";
import { DeviationChart } from "@/components/transitpulse/DeviationChart";
import { InsightsGrid } from "@/components/transitpulse/InsightsGrid";
import { getDayInsights } from "@/components/transitpulse/data";

export default function TransitPulsePage() {
  const [date, setDate] = useState<Date>(new Date());
  const insights = useMemo(() => getDayInsights(date), [date]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap border-b pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">TransitPulse</h1>
          <p className="text-sm text-muted-foreground">Crowd activity patterns along Waterfront Road by Canada Place</p>
        </div>
        <DatePicker date={date} onChange={setDate} />
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm" aria-labelledby="coverage-map-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Coverage area</p>
            <h2 id="coverage-map-title" className="mt-1 text-lg font-semibold tracking-tight">Waterfront, Vancouver</h2>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-teal-600" />
            Forecast location
          </div>
        </div>
        <div className="relative h-[260px] overflow-hidden bg-[#dcefeb] sm:h-[320px]">
          <div className="absolute inset-0 opacity-70" style={{ backgroundImage: "linear-gradient(rgba(15,118,110,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(15,118,110,.08) 1px, transparent 1px)", backgroundSize: "34px 34px" }} />
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1200 400" preserveAspectRatio="none" role="img" aria-label="Stylized map of Vancouver showing Waterfront Road in front of Canada Place">
            <defs>
              <pattern id="city-blocks" width="72" height="48" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
                <path d="M0 0H72M0 24H72M0 48H72M0 0V48M36 0V48M72 0V48" fill="none" stroke="#d6d8ce" strokeWidth="1" />
              </pattern>
            </defs>
            <path d="M0 0H1200V400H0Z" fill="#f1f0e8" />
            <path d="M0 0H515C545 42 585 76 635 112C700 158 765 189 835 210C925 238 1000 238 1065 276C1128 312 1165 355 1200 382V400H0Z" fill="#b9dfe1" />
            <path d="M0 0H515C545 42 585 76 635 112C700 158 765 189 835 210C925 238 1000 238 1065 276C1128 312 1165 355 1200 382" fill="none" stroke="#75b8b5" strokeWidth="3" />
            <path d="M0 0H1200V400H0Z" fill="url(#city-blocks)" opacity=".9" />
            <path d="M175 42C236 22 298 42 328 90C350 125 330 163 286 168C222 176 170 140 156 96C148 73 155 54 175 42Z" fill="#cfe1c9" stroke="#a8c6a6" strokeWidth="2" />
            <path d="M72 278C135 244 204 249 236 289C254 312 238 345 201 359C145 380 86 355 60 320C45 300 49 289 72 278Z" fill="#d8e8d0" stroke="#abc7a6" strokeWidth="2" />
            <g fill="none" stroke="#c5bfae" strokeLinecap="round" opacity=".95">
              <path d="M20 104C210 92 345 108 485 160S735 260 930 281S1085 275 1190 249" strokeWidth="8" />
              <path d="M90 374C244 320 330 276 470 260S700 216 865 137S1038 65 1195 40" strokeWidth="7" />
              <path d="M370 -5C416 73 478 135 585 171S762 211 875 183S1064 126 1210 126" strokeWidth="6" />
              <path d="M672 24C680 102 725 149 804 194S912 293 937 406" strokeWidth="5" />
            </g>
            <g fill="none" stroke="#ffffff" strokeLinecap="round" opacity=".96">
              <path d="M20 104C210 92 345 108 485 160S735 260 930 281S1085 275 1190 249" strokeWidth="3" />
              <path d="M90 374C244 320 330 276 470 260S700 216 865 137S1038 65 1195 40" strokeWidth="2.5" />
              <path d="M370 -5C416 73 478 135 585 171S762 211 875 183S1064 126 1210 126" strokeWidth="2.5" />
            </g>
            <g fill="#527b76" fontFamily="Georgia, serif" fontSize="16" opacity=".72">
              <text x="75" y="70">Coal Harbour</text>
              <text x="305" y="215">Downtown Vancouver</text>
              <text x="525" y="145">Canada Place</text>
              <text x="875" y="322">Burrard Inlet</text>
            </g>
            <g fill="#6f956e" fontFamily="Georgia, serif" fontSize="12" opacity=".85">
              <text x="205" y="105">Stanley Park</text>
              <text x="105" y="315">Harbour Green</text>
            </g>
          </svg>
          <div className="absolute left-[53%] top-[36%] -translate-x-1/2 -translate-y-1/2 sm:left-[51%]">
            <span className="absolute -inset-5 animate-ping rounded-full bg-teal-600/20" />
            <div className="relative flex h-11 w-11 items-center justify-center rounded-full border-4 border-white bg-teal-700 text-white shadow-lg"><MapPin size={19} fill="currentColor" /></div>
            <div className="mt-2 min-w-[155px] rounded-lg border border-white/80 bg-white/95 px-3 py-2 shadow-md">
              <p className="text-xs font-semibold text-foreground">Waterfront Road</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Canada Place measurement point</p>
            </div>
          </div>
          <div className="absolute bottom-4 left-4 rounded-lg border border-white/80 bg-white/90 px-3 py-2 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
            <span className="font-semibold text-foreground">Vancouver network</span><br />
            Canada Place waterfront road · synthetic coverage area
          </div>
          <div className="absolute right-4 top-4 rounded-lg border border-white/80 bg-white/90 px-3 py-2 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-teal-600" /> Forecast point
          </div>
        </div>
      </section>
      
      <div className="flex flex-row gap-4">
        <div className="flex flex-col max-w-[80%] flex-1 gap-4">
          <DeviationChart insights={insights} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ActivityIndexCard insights={insights} dayOfWeek={format(date, "EEEE")} />
            <StatsRow insights={insights} />
          </div>
        </div>
        <InsightsGrid insights={insights} />
      </div>

      <p className="text-xs text-muted-foreground pt-2">
        This is a research forecast, not a live traffic reading.
      </p>
    </div>
  );
}
