"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Contact, Call, Opportunity } from "@/lib/types"

interface ContactsCallTableProps {
  contacts: Contact[]
  calls: Call[]
  opportunities: Opportunity[]
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

export function ContactsCallTable({ contacts, calls, opportunities }: ContactsCallTableProps) {
  const getCallStats = (contactId: string) => {
    const contactCalls = calls.filter((c) => c.contactId === contactId)
    const completed = contactCalls.filter((c) => c.status === "completed").length
    const missed = contactCalls.filter((c) => c.status === "missed").length
    const lastCall = contactCalls
      .filter((c) => c.status === "completed")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    return { completed, missed, lastCall }
  }

  const getOpenOppsCount = (contactId: string) => {
    return opportunities.filter(
      (o) => o.contactId === contactId && o.status === "open"
    ).length
  }

  // Sort by tag count descending, then by least calls
  const sorted = [...contacts].sort((a, b) => {
    const aDiff = b.tags.length - a.tags.length
    if (aDiff !== 0) return aDiff
    return getCallStats(a.id).completed - getCallStats(b.id).completed
  })

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          Contacts by Tags & Call Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-auto max-h-[340px]">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs">Contact</TableHead>
                <TableHead className="text-xs">Tags</TableHead>
                <TableHead className="text-xs text-center">Completed</TableHead>
                <TableHead className="text-xs text-center">Missed</TableHead>
                <TableHead className="text-xs">Last Call</TableHead>
                <TableHead className="text-xs text-center">Open Opps</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((contact) => {
                const stats = getCallStats(contact.id)
                const openOpps = getOpenOppsCount(contact.id)
                return (
                  <TableRow key={contact.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {contact.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {contact.email}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {contact.tags.map((tag) => (
                          <span
                            key={tag}
                            className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium ${TAG_COLORS[tag] ?? "bg-secondary text-secondary-foreground border-border"}`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm font-semibold text-foreground">
                        {stats.completed}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`text-sm font-semibold ${stats.missed > 0 ? "text-destructive" : "text-foreground"}`}>
                        {stats.missed}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {stats.lastCall ? stats.lastCall.createdAt : "No calls"}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm font-semibold text-foreground">
                        {openOpps}
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
