import { Skeleton } from '@/components/ui/skeleton'

/** One skeleton shape for every page, so loading looks like the same product. */
export function PageSkeleton({ rows = 3, grid = false }: { rows?: number; grid?: boolean }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      {grid ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-[4/5] rounded-xl" />)}
        </div>
      ) : (
        Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)
      )}
    </div>
  )
}
