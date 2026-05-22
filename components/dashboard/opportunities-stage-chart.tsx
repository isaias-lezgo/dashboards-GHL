"use client"

import { useState } from "react"
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Button } from "@/components/ui/button"

interface StageChartData {
  stage: string
  hotLead: number
  warmLead: number
  coldLead: number
  hotLeadValue: number
  warmLeadValue: number
  coldLeadValue: number
}

interface OpportunitiesStageChartProps {
  data: StageChartData[]
}

const HOT_COLOR = "#ef4444"
const WARM_COLOR = "#f59e0b"
const COLD_COLOR = "#6b7280"

export function OpportunitiesStageChart({ data }: OpportunitiesStageChartProps) {
  const [metric, setMetric] = useState<"count" | "value">("count")

  const chartConfig = {
    hotLead: { label: "Hot Lead", color: HOT_COLOR },
    warmLead: { label: "Warm Lead", color: WARM_COLOR },
    coldLead: { label: "Cold Lead", color: COLD_COLOR },
    hotLeadValue: { label: "Hot Lead", color: HOT_COLOR },
    warmLeadValue: { label: "Warm Lead", color: WARM_COLOR },
    coldLeadValue: { label: "Cold Lead", color: COLD_COLOR },
  }

  const countKeys = ["hotLead", "warmLead", "coldLead"] as const
  const valueKeys = ["hotLeadValue", "warmLeadValue", "coldLeadValue"] as const
  const activeKeys = metric === "count" ? countKeys : valueKeys

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-semibold">Opportunities by Stage & Tag</CardTitle>
        <div className="flex items-center gap-1">
          <Button
            variant={metric === "count" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setMetric("count")}
          >
            Count
          </Button>
          <Button
            variant={metric === "value" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setMetric("value")}
          >
            Value
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="stage" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={metric === "value" ? (v) => `$${(v / 1000).toFixed(0)}K` : undefined}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => {
                      const label = String(name).replace(/Value$/, "").replace(/([A-Z])/g, " $1").trim()
                      const formattedValue = metric === "value"
                        ? `$${Number(value).toLocaleString()}`
                        : String(value)
                      return <span>{label}: {formattedValue}</span>
                    }}
                  />
                }
              />
              <Legend
                formatter={(value) => {
                  const map: Record<string, string> = {
                    hotLead: "Hot Lead",
                    warmLead: "Warm Lead",
                    coldLead: "Cold Lead",
                    hotLeadValue: "Hot Lead",
                    warmLeadValue: "Warm Lead",
                    coldLeadValue: "Cold Lead",
                  }
                  return map[value] || value
                }}
              />
              <Bar dataKey={activeKeys[0]} stackId="a" fill={HOT_COLOR} radius={[0, 0, 0, 0]} />
              <Bar dataKey={activeKeys[1]} stackId="a" fill={WARM_COLOR} />
              <Bar dataKey={activeKeys[2]} stackId="a" fill={COLD_COLOR} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
