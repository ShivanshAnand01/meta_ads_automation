'use client'

import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Check } from 'lucide-react'

/**
 * Form primitives.
 *
 * `Field` wires the label to the control and the hint/error to it via
 * aria-describedby, so a screen reader announces all three together. Errors
 * render next to the field they belong to, never only in a toast.
 */

interface FieldBaseProps {
  label: string
  hint?: ReactNode
  error?: string | null
  required?: boolean
  className?: string
  /** Extra content on the label row (e.g. a "saved" pill). */
  trailing?: ReactNode
}

export function Field({
  label, hint, error, required, className, trailing, children, id: idProp,
}: FieldBaseProps & { children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode; id?: string }) {
  const auto = useId()
  const id = idProp ?? auto
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-sm">
          {label}
          {required && <span aria-hidden="true" className="text-[var(--status-critical-ink)]"> *</span>}
        </Label>
        {trailing}
      </div>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-[var(--status-critical-ink)]">{error}</p>
      )}
    </div>
  )
}

export function TextField({
  value, onChange, placeholder, type = 'text', autoComplete, inputMode, disabled, maxLength, ...field
}: FieldBaseProps & {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  autoComplete?: string
  inputMode?: 'text' | 'numeric' | 'decimal' | 'url' | 'email' | 'tel'
  disabled?: boolean
  maxLength?: number
}) {
  return (
    <Field {...field}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          disabled={disabled}
          maxLength={maxLength}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className="h-10"
        />
      )}
    </Field>
  )
}

export function TextAreaField({
  value, onChange, placeholder, rows = 3, disabled, maxLength, lang, ...field
}: FieldBaseProps & {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  disabled?: boolean
  maxLength?: number
  lang?: string
}) {
  return (
    <Field
      {...field}
      trailing={
        maxLength ? (
          <span className={cn('text-[11px] tabular', value.length > maxLength ? 'text-[var(--status-critical-ink)]' : 'text-muted-foreground')}>
            {value.length}/{maxLength}
          </span>
        ) : field.trailing
      }
    >
      {({ id, describedBy, invalid }) => (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          lang={lang}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className="min-h-[2.5rem] text-base md:text-sm"
        />
      )}
    </Field>
  )
}

/**
 * A group of selectable chips. Single or multi select. Rendered as real
 * buttons with aria-pressed, so keyboard and screen-reader users get the
 * same control a mouse user does.
 */
export function ChipGroup<T extends string>({
  options, value, onChange, multi = false, className, size = 'default',
}: {
  options: Array<{ value: T; label: ReactNode; hint?: string }>
  value: T[] | T | null
  onChange: (next: T[] | T | null) => void
  multi?: boolean
  className?: string
  size?: 'sm' | 'default'
}) {
  const selected = new Set<T>(Array.isArray(value) ? value : value ? [value] : [])

  function toggle(v: T) {
    if (multi) {
      const next = new Set(selected)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      onChange([...next])
    } else {
      onChange(selected.has(v) ? null : v)
    }
  }

  return (
    <div className={cn('flex flex-wrap gap-2', className)} role={multi ? 'group' : 'radiogroup'}>
      {options.map((opt) => {
        const on = selected.has(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            role={multi ? undefined : 'radio'}
            aria-checked={multi ? undefined : on}
            aria-pressed={multi ? on : undefined}
            title={opt.hint}
            onClick={() => toggle(opt.value)}
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
              size === 'sm' && 'min-h-8 px-2.5 text-xs',
              on
                ? 'border-primary bg-primary/10 font-medium text-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
            )}
          >
            {on && <Check aria-hidden="true" className="h-3.5 w-3.5 text-primary" />}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Free-text list editor: type, press Enter or comma to add, click × to
 * remove. Used for regions, cities, brand colours.
 */
export function TagInput({
  value, onChange, placeholder, ...field
}: FieldBaseProps & { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  function add(raw: string) {
    const items = raw.split(',').map((s) => s.trim()).filter(Boolean)
    if (!items.length) return
    const next = [...value]
    for (const item of items) if (!next.includes(item)) next.push(item)
    onChange(next)
  }

  return (
    <Field {...field}>
      {({ id, describedBy }) => (
        <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
          {value.map((item) => (
            <span key={item} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => onChange(value.filter((v) => v !== item))}
                className="-mr-1 rounded-full p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
          <input
            id={id}
            aria-describedby={describedBy}
            placeholder={value.length ? '' : placeholder}
            className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              const t = e.currentTarget
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                add(t.value)
                t.value = ''
              } else if (e.key === 'Backspace' && !t.value && value.length) {
                onChange(value.slice(0, -1))
              }
            }}
            onBlur={(e) => {
              if (e.currentTarget.value.trim()) {
                add(e.currentTarget.value)
                e.currentTarget.value = ''
              }
            }}
          />
        </div>
      )}
    </Field>
  )
}

/** A labelled on/off row, for settings. */
export function SwitchRow({
  label, description, control, className,
}: { label: string; description?: ReactNode; control: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-3', className)}>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  )
}
