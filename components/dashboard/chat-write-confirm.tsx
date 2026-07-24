"use client";

import { Check, X, AlertTriangle, Pencil, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PendingWrite, WriteReceipt } from "@/hooks/use-agent-loop";

export function ChatWriteConfirm({
  pending,
  onResolve,
}: {
  pending: PendingWrite;
  onResolve: (d: { approve: boolean }) => void;
}) {
  const [applying, setApplying] = useState(false);
  const rows = pending.rows;
  const many = rows.length > 6;
  const shown = many ? rows.slice(0, 5) : rows;

  return (
    <div className="w-full max-w-[85%] self-start rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Pencil className="h-3.5 w-3.5" />
        </span>
        <p className="text-sm font-semibold text-foreground">{pending.title}</p>
      </div>
      {pending.subtitle && (
        <p className="mt-1 pl-8 text-xs text-muted-foreground">{pending.subtitle}</p>
      )}

      {shown.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {shown.map((r, i) => (
            <div
              key={i}
              className="rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-xs"
            >
              {rows.length > 1 && (
                <div className="font-medium text-foreground/90">
                  {r.label}
                  {r.sublabel && (
                    <span className="ml-1 text-[10px] text-muted-foreground/70">
                      {r.sublabel}
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground line-through decoration-muted-foreground/40">
                  {r.before}
                </span>
                <span className="text-primary">→</span>
                <span className="font-medium text-foreground">{r.after}</span>
              </div>
            </div>
          ))}
          {many && (
            <p className="pl-1 text-[11px] text-muted-foreground">
              … y {rows.length - 5} más
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={applying}
          onClick={() => onResolve({ approve: false })}
          className="h-7 gap-1.5 px-3 text-[11px]"
        >
          <X className="h-3 w-3" /> Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={applying}
          onClick={() => {
            setApplying(true);
            onResolve({ approve: true });
          }}
          className="h-7 gap-1.5 px-3 text-[11px]"
        >
          {applying ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          Aplicar
        </Button>
      </div>
    </div>
  );
}

export function WriteReceiptCard({ receipt }: { receipt: WriteReceipt }) {
  const icon = {
    applied: <Check className="h-3.5 w-3.5" />,
    partial: <AlertTriangle className="h-3.5 w-3.5" />,
    failed: <X className="h-3.5 w-3.5" />,
    cancelled: <X className="h-3.5 w-3.5" />,
  }[receipt.status];
  const tone = {
    applied: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
    partial: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
    failed: "border-destructive/30 bg-destructive/5 text-destructive",
    cancelled: "border-border bg-muted/30 text-muted-foreground",
  }[receipt.status];
  const label = {
    applied: "Aplicado",
    partial: `${receipt.ok} de ${(receipt.ok ?? 0) + (receipt.failed ?? 0)} aplicados`,
    failed: "Falló",
    cancelled: "Cancelado",
  }[receipt.status];

  return (
    <div className={cn("w-full max-w-[85%] self-start rounded-xl border px-3.5 py-2.5 text-xs", tone)}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium">
          {receipt.title} · {label}
        </span>
      </div>
      {receipt.detail && <p className="mt-0.5 pl-6 opacity-80">{receipt.detail}</p>}
      {receipt.failures && receipt.failures.length > 0 && (
        <ul className="mt-1 space-y-0.5 pl-6 opacity-80">
          {receipt.failures.slice(0, 5).map((f, i) => (
            <li key={i}>
              {f.name ?? f.id}: {f.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
