"use client"

import * as React from "react"
import { Check, ChevronDown, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface MultiSelectProps {
  options: string[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
  /** Override the trigger label format. Default: "N seleccionados" / single value. */
  formatLabel?: (selected: string[]) => string
  /** Map an option value to a human-friendly label (used in trigger & list). */
  renderLabel?: (option: string) => string
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Seleccionar…",
  searchPlaceholder = "Buscar…",
  emptyText = "Sin resultados",
  disabled,
  className,
  formatLabel,
  renderLabel,
}: MultiSelectProps) {
  const label = (option: string) => (renderLabel ? renderLabel(option) : option)
  const [open, setOpen] = React.useState(false)

  const selectedSet = React.useMemo(() => new Set(value), [value])

  function toggle(option: string) {
    if (selectedSet.has(option)) {
      onChange(value.filter((v) => v !== option))
    } else {
      onChange([...value, option])
    }
  }

  function clearAll(e: React.MouseEvent) {
    e.stopPropagation()
    onChange([])
  }

  const triggerLabel = React.useMemo(() => {
    if (value.length === 0) return placeholder
    if (formatLabel) return formatLabel(value)
    if (value.length === 1) return label(value[0])
    return `${value.length} seleccionados`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, placeholder, formatLabel, renderLabel])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            value.length === 0 && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <span className="flex items-center gap-1 flex-shrink-0 ml-2">
            {value.length > 0 && !disabled && (
              <span
                role="button"
                tabIndex={0}
                onClick={clearAll}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onChange([])
                  }
                }}
                className="rounded-sm opacity-60 hover:opacity-100 hover:bg-muted p-0.5"
                aria-label="Limpiar selección"
              >
                <X className="h-3 w-3" />
              </span>
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {value.length > 0 && (
              <>
                <CommandGroup>
                  <CommandItem
                    onSelect={() => onChange([])}
                    className="justify-center text-xs text-muted-foreground"
                  >
                    Limpiar selección
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selectedSet.has(option)
                return (
                  <CommandItem
                    key={option}
                    value={`${option} ${label(option)}`}
                    onSelect={() => toggle(option)}
                  >
                    <div
                      className={cn(
                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50 [&_svg]:invisible",
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </div>
                    <span className="truncate">{label(option)}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
