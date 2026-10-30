"use client"

// Tab bar of the AI panel: the client's own tabs first, then the fixed
// Marketing / Ventas / Asistente IA tabs, which keep working exactly as today.
import { useState, type ComponentType } from "react"
import { BarChart3, ChevronDown, LayoutGrid, Plus, Sparkles, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Tab } from "@/lib/widgets/spec"

export const EMPTY_TAB_ID = "__empty__"

const FIXED: { id: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "marketing", label: "Marketing", icon: TrendingUp },
  { id: "sales", label: "Ventas", icon: BarChart3 },
  { id: "conversations", label: "Asistente IA", icon: Sparkles },
]

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex shrink-0 items-center gap-2 py-3 text-sm font-medium transition-colors duration-200",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
      {active && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />}
    </button>
  )
}

export function PanelTabs({
  tabs,
  activeId,
  onSelect,
  onRename,
  onDelete,
  onAdd,
}: {
  tabs: Tab[]
  activeId: string
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onAdd: () => void
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Tab | null>(null)

  return (
    <nav className="border-b border-border bg-card px-4 sm:px-6" aria-label="Vistas del panel">
      <div className="flex items-center gap-6 overflow-x-auto sm:gap-8">
        {tabs.length === 0 && (
          <TabButton active={activeId === EMPTY_TAB_ID} onClick={() => onSelect(EMPTY_TAB_ID)}>
            <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
            Mi panel
          </TabButton>
        )}
        {tabs.map((t) =>
          renaming?.id === t.id ? (
            <form
              key={t.id}
              className="py-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (renaming.title.trim()) onRename(t.id, renaming.title.trim())
                setRenaming(null)
              }}
            >
              <Input
                autoFocus
                value={renaming.title}
                maxLength={80}
                onChange={(e) => setRenaming({ id: t.id, title: e.target.value })}
                onBlur={() => setRenaming(null)}
                className="h-8 w-44 text-sm"
              />
            </form>
          ) : (
            <div key={t.id} className="flex shrink-0 items-center">
              <TabButton active={activeId === t.id} onClick={() => onSelect(t.id)}>
                <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
                {t.title}
              </TabButton>
              {activeId === t.id && (
                <Popover open={menuFor === t.id} onOpenChange={(o) => setMenuFor(o ? t.id : null)}>
                  <PopoverTrigger asChild>
                    <button type="button" className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Opciones de ${t.title}`}>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-40 p-1">
                    <button
                      type="button"
                      className="flex w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                      onClick={() => {
                        setMenuFor(null)
                        setRenaming({ id: t.id, title: t.title })
                      }}
                    >
                      Renombrar
                    </button>
                    <button
                      type="button"
                      className="flex w-full rounded-md px-2 py-1.5 text-left text-xs text-destructive hover:bg-muted"
                      onClick={() => {
                        setMenuFor(null)
                        if (t.widgets.length > 0) setConfirmDelete(t)
                        else onDelete(t.id)
                      }}
                    >
                      Eliminar pestaña
                    </button>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )
        )}
        <button
          type="button"
          onClick={onAdd}
          className="flex shrink-0 items-center gap-1 py-3 text-xs font-medium text-muted-foreground hover:text-foreground"
          aria-label="Nueva pestaña"
        >
          <Plus className="h-3.5 w-3.5" />
          Pestaña
        </button>
        <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
        {FIXED.map(({ id, label, icon: Icon }) => (
          <TabButton key={id} active={activeId === id} onClick={() => onSelect(id)}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {label}
          </TabButton>
        ))}
      </div>

      <Dialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar la pestaña «{confirmDelete?.title}»?</DialogTitle>
            <DialogDescription>
              Tiene {confirmDelete?.widgets.length} {confirmDelete?.widgets.length === 1 ? "gráfica" : "gráficas"}. Podrás deshacerlo justo después.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDelete) onDelete(confirmDelete.id)
                setConfirmDelete(null)
              }}
            >
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  )
}
