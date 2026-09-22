'use client'

import { useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, TriangleAlert } from 'lucide-react'

/**
 * Confirmation for destructive or money-moving actions. Replaces the bare
 * `window.confirm` calls, which cannot be styled, cannot explain consequences,
 * and cannot show progress.
 */
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive = false, onConfirm, children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => Promise<void> | void
  children?: ReactNode
}) {
  const [busy, setBusy] = useState(false)

  async function handle() {
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {destructive && (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--status-critical)]/10">
                <TriangleAlert aria-hidden="true" className="h-4 w-4 text-[var(--status-critical-ink)]" />
              </div>
            )}
            <div className="space-y-1">
              <DialogTitle>{title}</DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
            </div>
          </div>
        </DialogHeader>
        {children}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={handle} disabled={busy}>
            {busy && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
