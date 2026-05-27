"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Opportunity, Contact, Task, Call } from "@/lib/types"
import { Phone, CheckCircle2, Clock, AlertTriangle } from "lucide-react"

interface OpportunitiesTableProps {
  opportunities: Opportunity[]
  contacts: Contact[]
  tasks: Task[]
  calls: Call[]
  onRowClick: (opportunityId: string) => void
}

const TAG_COLORS: Record<string, string> = {
  "Hot Lead": "bg-red-100 text-red-700 border-red-200",
  "Warm Lead": "bg-amber-100 text-amber-700 border-amber-200",
  "Cold Lead": "bg-gray-100 text-gray-600 border-gray-200",
  "Enterprise": "bg-blue-100 text-blue-700 border-blue-200",
  "Mid-Market": "bg-teal-100 text-teal-700 border-teal-200",
  "SMB": "bg-orange-100 text-orange-700 border-orange-200",
  "Decision Maker": "bg-indigo-100 text-indigo-700 border-indigo-200",
  "Referral": "bg-emerald-100 text-emerald-700 border-emerald-200",
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  won: "bg-emerald-100 text-emerald-700 border-emerald-200",
  lost: "bg-red-100 text-red-700 border-red-200",
}

export function OpportunitiesTable({
  opportunities,
  contacts,
  tasks,
  calls,
  onRowClick,
}: OpportunitiesTableProps) {
  const [onlyOpenTasks, setOnlyOpenTasks] = useState(false)
  const [stageFilter, setStageFilter] = useState("all")

  const stages = Array.from(new Set(opportunities.map((o) => o.stage)))

  const contactMap = new Map(contacts.map((c) => [c.id, c]))

  const getTaskSummary = (oppId: string) => {
    const oppTasks = tasks.filter((t) => t.opportunityId === oppId)
    const open = oppTasks.filter((t) => t.status === "pending")
    const completed = oppTasks.filter((t) => t.status === "completed")
    const nearest = open.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))[0]
    return { open: open.length, completed: completed.length, nearest }
  }

  const getCallActivity = (contactId: string) => {
    const contactCalls = calls.filter(
      (c) => c.contactId === contactId && c.status === "completed"
    )
    const lastCall = contactCalls.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    )[0]
    return { count: contactCalls.length, lastCall }
  }

  let filtered = opportunities
  if (stageFilter !== "all") {
    filtered = filtered.filter((o) => o.stage === stageFilter)
  }
  if (onlyOpenTasks) {
    filtered = filtered.filter((o) => {
      const summary = getTaskSummary(o.id)
      return summary.open > 0
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-semibold">
          Opportunities + Tags + Tasks
        </CardTitle>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="open-tasks"
              checked={onlyOpenTasks}
              onCheckedChange={(checked) => setOnlyOpenTasks(checked === true)}
            />
            <label htmlFor="open-tasks" className="text-xs text-muted-foreground cursor-pointer">
              Open tasks only
            </label>
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="h-7 w-[130px] text-xs">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {stages.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-auto max-h-[500px]">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs">Opportunity</TableHead>
                <TableHead className="text-xs">Stage</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Value</TableHead>
                <TableHead className="text-xs">Contact & Tags</TableHead>
                <TableHead className="text-xs">Tasks</TableHead>
                <TableHead className="text-xs">Calls</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                    No opportunities match current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((opp) => {
                  const contact = contactMap.get(opp.contactId)
                  const taskSummary = getTaskSummary(opp.id)
                  const callActivity = getCallActivity(opp.contactId)
                  const today = new Date().toISOString().split("T")[0]
                  const isOverdue = taskSummary.nearest && (taskSummary.nearest.dueDate ?? "") < today

                  return (
                    <TableRow
                      key={opp.id}
                      className="cursor-pointer"
                      onClick={() => onRowClick(opp.id)}
                    >
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium text-foreground">
                            {opp.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {opp.pipelineName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-foreground">{opp.stage}</span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[11px] ${STATUS_STYLES[opp.status]}`}
                        >
                          {opp.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-sm font-semibold text-foreground">
                          {formatCurrency(opp.value)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-foreground">
                            {contact?.name ?? "Unknown"}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {contact?.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium ${TAG_COLORS[tag] ?? "bg-secondary text-secondary-foreground border-border"}`}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 text-xs">
                            <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
                            <span className="text-foreground">{taskSummary.completed}</span>
                            <Clock className="h-3 w-3 text-muted-foreground ml-1" />
                            <span className="text-foreground">{taskSummary.open}</span>
                          </div>
                          {taskSummary.nearest && (
                            <div className="flex items-center gap-1 text-[11px]">
                              {isOverdue && <AlertTriangle className="h-3 w-3 text-destructive" />}
                              <span className={isOverdue ? "text-destructive" : "text-muted-foreground"}>
                                {taskSummary.nearest.title}
                              </span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-xs">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          <span className="text-foreground">{callActivity.count}</span>
                          {callActivity.lastCall && (
                            <span className="text-[11px] text-muted-foreground ml-1">
                              {callActivity.lastCall.createdAt}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
