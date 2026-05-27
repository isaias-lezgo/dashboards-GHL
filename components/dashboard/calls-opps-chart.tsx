"use client"

import { useState } from "react"
import {
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  ComposedChart,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { NonZeroTooltipContent } from "./dashboard-ui"
import { Button } from "@/components/ui/button"

interface CallsOppsData {
  date: string
  calls: number
  opportunities: number
}

interface CallsOppsChartProps {
  data: CallsOppsData[]
}

const CALLS_COLOR = "#3b82f6"
const OPPS_COLOR = "#10b981"

export function CallsOppsChart({ data }: CallsOppsChartProps) {
  const [bucket, setBucket] = useState<"daily" | "weekly">("daily")

  const chartConfig = {
    calls: { label: "Calls", color: CALLS_COLOR },
    opportunities: { label: "New Opportunities", color: OPPS_COLOR },
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-semibold">Calls vs New Opportunities</CardTitle>
        <div className="flex items-center gap-1">
          <Button
            variant={bucket === "daily" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setBucket("daily")}
          >
            Daily
          </Button>
          <Button
            variant={bucket === "weekly" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setBucket("weekly")}
          >
            Weekly
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <ChartTooltip content={<NonZeroTooltipContent />} />
              <Legend />
              <Bar dataKey="calls" fill={CALLS_COLOR} radius={[4, 4, 0, 0]} name="Calls" barSize={20} />
              <Line
                type="monotone"
                dataKey="opportunities"
                stroke={OPPS_COLOR}
                strokeWidth={2}
                dot={{ r: 4, fill: OPPS_COLOR }}
                name="New Opportunities"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
