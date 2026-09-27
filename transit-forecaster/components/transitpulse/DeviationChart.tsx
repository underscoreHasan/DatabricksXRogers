"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { hourLabel } from "./data";
import type { DayInsights, HourPoint } from "./types";

function ReadoutTooltip({ active, payload, ctx }: any) {
  if (!active || !payload?.length) return null;
  const point: HourPoint = payload[0].payload;
  const activeWindow = ctx.windows.find((w: any) => point.hour >= w.start && point.hour <= w.end);
  const sign = point.deviation >= 0 ? "+" : "";

  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <span className="font-medium">{hourLabel(point.hour)}</span>{" "}
      <span className="text-muted-foreground">
        — {sign}
        {point.deviation.toFixed(0)}% vs. typical, ~{point.dwell} min avg dwell
      </span>
      {activeWindow && (
        <Badge variant="secondary" className="ml-2 align-middle">
          {activeWindow.label}
        </Badge>
      )}
    </div>
  );
}

export function DeviationChart({ insights }: { insights: DayInsights }) {
  const { hourly, ctx, isFuture } = insights;
  const [hasHovered, setHasHovered] = useState(false);

  return (
    <Card className="flex-1">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Deviation from typical, by hour</CardTitle>
        <p className="text-sm text-muted-foreground">
          {isFuture
            ? "Projected typical pattern for this day type — not a forecast of actual conditions."
            : "Actual recorded pattern compared against the historical baseline for this day type."}
        </p>
      </CardHeader>
      <CardContent>
        <div className="min-h-[280px]" onMouseEnter={() => setHasHovered(true)}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={hourly} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="devFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#e8a33d" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#e8a33d" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
              <XAxis
                dataKey="hour"
                tickFormatter={(h) => hourLabel(h).replace(":00", "")}
                ticks={[0, 6, 12, 18, 23]}
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
                width={44}
              />
              <ReferenceArea y1={-15} y2={15} fill="hsl(var(--muted))" fillOpacity={0.15} />
              {ctx.windows.map((w) => (
                <ReferenceArea
                  key={w.label}
                  x1={w.start}
                  x2={w.end}
                  fill="#e8a33d"
                  fillOpacity={0.12}
                  label={{ value: w.label, position: "insideTop", fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                />
              ))}
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Tooltip content={<ReadoutTooltip ctx={ctx} />} cursor={{ stroke: "hsl(var(--foreground))", strokeOpacity: 0.4 }} />
              <Area
                type="monotone"
                dataKey="deviation"
                stroke="#e8a33d"
                strokeWidth={2}
                fill="url(#devFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {!hasHovered && (
          <p className="text-sm text-muted-foreground mt-2">Hover across the chart to see what&apos;s happening hour by hour.</p>
        )}
      </CardContent>
    </Card>
  );
}
