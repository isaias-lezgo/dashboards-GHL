"use client"

import * as React from "react"
import { Check, ChevronDown, Filter, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

export type Filters = {
  dateRange: string
  pipelines: string[]
  members: string[]
  tags: string[]
  search: string
}

interface FilterBarProps {
  filters: Filters
  onFiltersChange: (filters: Filters) => void
  availablePipelines?: string[]
  availableMembers?: string[]
  availableTags?: string[]
  className?: string
}

const ALL_VALUE = "__all__"

const DATE_OPTIONS = [
  { label: "Hoy", value: "Today" },
  { label: "7D", value: "Last 7 Days" },
  { label: "30D", value: "Last 30 Days" },
  { label: "Mes", value: "This Month" },
  { label: "Trimestre", value: "This Quarter" },
  { label: "Año", value: "This Year" },
  { label: "Todo", value: "All Time" },
] as const

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ")
}

export function FilterBar({
  filters,
  onFiltersChange,
  availablePipelines = [],
  availableMembers = [],
  availableTags = [],
  className,
}: FilterBarProps) {
  const [tagsOpen, setTagsOpen] = React.useState(false)

  const activeMember = filters.members[0] ?? ""
  const activePipeline = filters.pipelines[0] ?? ""
  const activeTags = filters.tags ?? []

  const hasActiveFilters =
    filters.dateRange !== "All Time" ||
    activeMember !== "" ||
    activePipeline !== "" ||
    activeTags.length > 0 ||
    filters.search.trim() !== ""

  const updateFilters = React.useCallback(
    (patch: Partial<Filters>) => {
      onFiltersChange({
        ...filters,
        ...patch,
      })
    },
    [filters, onFiltersChange]
  )

  const handleMemberChange = React.useCallback(
    (value: string) => {
      updateFilters({
        members: value === ALL_VALUE ? [] : [value],
      })
    },
    [updateFilters]
  )

  const handlePipelineChange = React.useCallback(
    (value: string) => {
      updateFilters({
        pipelines: value === ALL_VALUE ? [] : [value],
      })
    },
    [updateFilters]
  )

  const toggleTag = React.useCallback(
    (tag: string) => {
      const nextTags = activeTags.includes(tag)
        ? activeTags.filter((t) => t !== tag)
        : [...activeTags, tag]

      updateFilters({ tags: nextTags })
    },
    [activeTags, updateFilters]
  )

  const clearAll = React.useCallback(() => {
    updateFilters({
      dateRange: "All Time",
      pipelines: [],
      members: [],
      tags: [],
      search: "",
    })
  }, [updateFilters])

  return (
    <section
      aria-label="Barra de filtros"
      className={cn(
        "sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className
      )}
    >
      <div className="px-4 py-3 md:px-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 flex shrink-0 items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Filtros
              </span>
            </div>

            <div
              className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5"
              role="group"
              aria-label="Rango de fechas"
            >
              {DATE_OPTIONS.map(({ label, value }) => {
                const isActive = filters.dateRange === value

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateFilters({ dateRange: value })}
                    aria-pressed={isActive}
                    className={cn(
                      "h-6 shrink-0 rounded px-2 text-[11px] font-medium transition-all",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {availableMembers.length > 0 && (
              <div className="shrink-0">
                <Select
                  value={activeMember || ALL_VALUE}
                  onValueChange={handleMemberChange}
                >
                  <SelectTrigger
                    aria-label="Filtrar por miembro"
                    className="h-8 w-[170px] rounded-md text-xs"
                  >
                    <SelectValue placeholder="Todos los miembros" />
                  </SelectTrigger>
                  <SelectContent className="w-[170px]">
                    <SelectItem value={ALL_VALUE}>Todos los miembros</SelectItem>
                    {availableMembers.map((member) => (
                      <SelectItem key={member} value={member}>
                        {member}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {availablePipelines.length > 0 && (
              <div className="shrink-0">
                <Select
                  value={activePipeline || ALL_VALUE}
                  onValueChange={handlePipelineChange}
                >
                  <SelectTrigger
                    aria-label="Filtrar por pipeline"
                    className="h-8 w-[190px] rounded-md text-xs"
                  >
                    <SelectValue placeholder="Todos los pipelines" />
                  </SelectTrigger>
                  <SelectContent className="w-[190px]">
                    <SelectItem value={ALL_VALUE}>Todos los pipelines</SelectItem>
                    {availablePipelines.map((pipeline) => (
                      <SelectItem key={pipeline} value={pipeline}>
                        {pipeline}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {availableTags.length > 0 && (
              <div className="shrink-0">
                <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={tagsOpen}
                      className="h-8 w-[220px] justify-between rounded-md text-xs font-normal"
                    >
                      <span className="truncate text-left">
                        {activeTags.length > 0
                          ? `${activeTags.length} tag${activeTags.length > 1 ? "s" : ""} seleccionados`
                          : "Todos los tags"}
                      </span>
                      <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-60" />
                    </Button>
                  </PopoverTrigger>

                  <PopoverContent
                    align="start"
                    className="w-[220px] p-0"
                  >
                    <Command>
                      <CommandInput placeholder="Buscar tag..." />
                      <CommandList>
                        <CommandEmpty>No se encontraron tags.</CommandEmpty>

                        <CommandGroup>
                          {availableTags.map((tag) => {
                            const isSelected = activeTags.includes(tag)

                            return (
                              <CommandItem
                                key={tag}
                                value={tag}
                                onSelect={() => toggleTag(tag)}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    isSelected ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <span className="truncate">{tag}</span>
                              </CommandItem>
                            )
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            )}

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAll}
                className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Limpiar filtros"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Limpiar
              </button>
            )}
          </div>

          {activeTags.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-1.5"
              aria-label="Tags activos"
            >
              {activeTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="h-6 cursor-pointer gap-1 rounded-md pl-2 pr-1 text-[11px]"
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                  <X className="h-3 w-3" aria-hidden="true" />
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}