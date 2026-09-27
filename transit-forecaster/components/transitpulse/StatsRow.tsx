import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { DayInsights } from "./types";

export function StatsRow({ insights }: { insights: DayInsights }) {
  const { visitPct, avgDwell } = insights;
  const localPct = 100 - visitPct;

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground mb-2">Local vs. visiting</p>
          <p className="text-2xl font-semibold font-mono">
            {localPct.toFixed(0)}% / {visitPct.toFixed(0)}%
          </p>
          <Progress value={visitPct} className="mt-3 h-2" />
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>Local</span>
            <span>Visiting</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground mb-2">Avg. dwell time</p>
          <p className="text-2xl font-semibold font-mono">{avgDwell} min</p>
          <p className="text-sm text-muted-foreground mt-2">
            {avgDwell > 40 ? "Long dwell — lingering, not just passing through" : "Short dwell — mostly transit turnover"}
          </p>
        </CardContent>
      </Card>
    </>
  );
}
