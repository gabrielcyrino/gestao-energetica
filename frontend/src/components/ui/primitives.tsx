/** Componentes base: card, botão, campos, abas, diálogo, tabela e estados vazios. */
import { Dialog as RDialog, Popover as RPopover, Tabs as RTabs, Tooltip as RTooltip } from 'radix-ui'
import { clsx } from 'clsx'
import { Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'

export function cn(...parts: (string | false | null | undefined)[]) {
  return clsx(parts)
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('card', className)}>{children}</section>
}

export function CardHeader({
  title,
  subtitle,
  actions,
  icon,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex items-start justify-between gap-3 border-b border-edge px-4 py-3', className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Button({
  children,
  variant = 'default',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost'; size?: 'sm' | 'md' }) {
  return (
    <button
      className={cn(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'ghost' && 'btn-ghost',
        size === 'sm' && 'px-2 py-1 text-xs',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function Badge({
  children,
  color,
  className,
  title,
}: {
  children: ReactNode
  color?: string
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium', className)}
      style={color ? { borderColor: color, color } : undefined}
    >
      {children}
    </span>
  )
}

export function Chip({ children, active, onClick, title }: { children: ReactNode; active?: boolean; onClick?: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'border-accent bg-accent-soft text-accent-ink' : 'border-edge text-ink-2 hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  )
}

export function Field({ label, hint, children, required }: { label: string; hint?: ReactNode; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-ink-2">
        {label}
        {required && <span className="text-critical-text">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('input', props.className)} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('textarea', props.className)} rows={props.rows ?? 3} />
}

export function Select({
  options,
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string | number; label: string }[] }) {
  return (
    <select {...props} className={cn('select', className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex rounded-lg border border-edge bg-surface-2 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs({
  tabs,
  value,
  onChange,
  children,
}: {
  tabs: { value: string; label: ReactNode; count?: number }[]
  value: string
  onChange: (v: string) => void
  children?: ReactNode
}) {
  return (
    <RTabs.Root value={value} onValueChange={onChange}>
      <RTabs.List className="flex gap-1 overflow-x-auto border-b border-edge">
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className={cn(
              'relative whitespace-nowrap px-3 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink',
              'data-[state=active]:text-ink data-[state=active]:after:absolute data-[state=active]:after:inset-x-2',
              'data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-accent',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 text-[11px] text-muted num">{t.count}</span>}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  )
}

export function Tooltip({ children, content }: { children: ReactNode; content: ReactNode }) {
  if (!content) return <>{children}</>
  return (
    <RTooltip.Provider delayDuration={200}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            sideOffset={6}
            className="z-50 max-w-xs rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-xs text-ink shadow-lg"
          >
            {content}
            <RTooltip.Arrow className="fill-[var(--surface)]" />
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  )
}

export function Popover({ trigger, children, align = 'start' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'center' | 'end' }) {
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align={align}
          sideOffset={6}
          className="z-50 max-h-[70vh] w-80 overflow-auto rounded-xl border border-edge bg-surface p-3 shadow-xl"
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  )
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" />
        <RDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[min(96vw,var(--w))] -translate-x-1/2 -translate-y-1/2',
            'overflow-auto rounded-xl border border-edge bg-surface shadow-2xl',
          )}
          style={{ ['--w' as string]: wide ? '1000px' : '640px' }}
        >
          <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-edge bg-surface px-4 py-3">
            <div>
              <RDialog.Title className="text-sm font-semibold">{title}</RDialog.Title>
              {description && <RDialog.Description className="mt-0.5 text-xs text-ink-2">{description}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <button className="btn btn-ghost px-1.5 py-1" aria-label="Fechar">
                <X size={16} />
              </button>
            </RDialog.Close>
          </header>
          <div className="px-4 py-3">{children}</div>
          {footer && <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-edge bg-surface px-4 py-3">{footer}</footer>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-3', className)} style={style} />
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-xs text-ink-2">
      <Loader2 size={14} className="animate-spin" />
      {label ?? 'Carregando…'}
    </div>
  )
}

export function EmptyState({ title, description, icon, action }: { title: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="max-w-md text-xs text-ink-2">{description}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="m-4 rounded-lg border border-[var(--critical)] bg-[var(--surface-2)] p-3 text-xs text-critical-text">
      <strong className="font-semibold">Não foi possível carregar: </strong>
      {message}
    </div>
  )
}

/** Envolve conteúdo que depende de query: mantém o render anterior durante refetch (sem "flash"). */
export function QueryBoundary({
  query,
  children,
  height = 200,
}: {
  query: { isPending: boolean; isFetching?: boolean; error: unknown }
  children: ReactNode
  height?: number
}) {
  if (query.error) return <ErrorState error={query.error} />
  if (query.isPending) return <Skeleton className="m-4" style={{ height }} />
  return <div className={query.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>{children}</div>
}
