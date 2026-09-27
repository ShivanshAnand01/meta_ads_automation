import { cn } from '@/lib/utils'

/**
 * The agent's face: a small glass sphere built from gradients, no image or
 * WebGL, so it costs nothing to render. It animates only while working.
 */
export function AiOrb({ size = 32, working = false, className }: { size?: number; working?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-state={working ? 'working' : 'idle'}
      className={cn('ai-orb inline-block', className)}
      style={{ width: size, height: size, fontSize: size }}
    />
  )
}
