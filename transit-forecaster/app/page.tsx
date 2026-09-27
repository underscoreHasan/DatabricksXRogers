"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";

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
          <p className="text-sm text-muted-foreground">Crowd activity patterns near Waterfront Station</p>
        </div>
        <DatePicker date={date} onChange={setDate} />
      </div>
      
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
