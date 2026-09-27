import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { activityLabel } from "./data";
import type { DayInsights } from "./types";

const TONE_CLASSES: Record<string, string> = {
  quiet: "text-cyan-400",
  typical: "text-muted-foreground",
  elevated: "text-amber-400",
  busy: "text-rose-400",
};

export function ActivityIndexCard({ insights, dayOfWeek }: { insights: DayInsights; dayOfWeek: string }) {
  const { avgDeviation, ctx } = insights;
  const { label, tone } = activityLabel(avgDeviation);
  const sign = avgDeviation >= 0 ? "+" : "";

  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground mb-2">Activity index</p>
        <p className={cn("text-4xl font-semibold font-mono tracking-tight", TONE_CLASSES[tone])}>
          {sign}
          {avgDeviation.toFixed(0)}%
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          {label} for a {dayOfWeek} in {ctx.season.toLowerCase()}
        </p>
      </CardContent>
    </Card>
  );
}
