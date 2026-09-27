import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DayInsights } from "./types";

export function InsightsGrid({ insights }: { insights: DayInsights }) {
  const { ctx, avgDeviation } = insights;

  const items: { k: string; v: string; flagged: boolean }[] = [
    { k: "Day type", v: ctx.weekend ? "Weekend" : "Weekday", flagged: ctx.weekend },
    { k: "Holiday", v: ctx.holiday ? "Yes — statutory holiday" : "No", flagged: ctx.holiday },
    { k: "Cruise ship in port", v: ctx.cruise ? "Yes — Canada Place" : "No", flagged: ctx.cruise },
    { k: "Citywide event", v: ctx.event ? "Yes — evening event nearby" : "No", flagged: ctx.event },
    { k: "Season", v: ctx.season, flagged: false },
  ];

  const unexplained = Math.abs(avgDeviation) > 20 && !ctx.holiday && !ctx.cruise && !ctx.event;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">What&apos;s driving this day</CardTitle>
        <p className="text-sm text-muted-foreground">Known context that may explain the pattern above.</p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {items.map((item) => (
          <div key={item.k} className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground mb-1">{item.k}</p>
            <p className="text-sm font-medium">{item.v}</p>
            <Badge variant={item.flagged ? "default" : "secondary"} className="mt-2 text-[10px]">
              {item.flagged ? "contributing factor" : "no impact"}
            </Badge>
          </div>
        ))}
        {unexplained && (
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground mb-1">Unexplained deviation</p>
            <p className="text-sm font-medium">No matching factor found</p>
            <Badge className="mt-2 text-[10px]">flagged for review</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
