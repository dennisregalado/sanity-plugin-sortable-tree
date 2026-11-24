import {type ReactNode, useEffect, useState} from 'react'

export const COLLAPSE_DURATION_MS = 250

interface Props {
  open: boolean
  /** Renders the subtree; `disabled` while it's closed or closing */
  children: (disabled: boolean) => ReactNode
}

/** An item's nested list, sliding open and closed. Closed lists unmount once they're out of view. */
export function CollapsibleSubtree({open, children}: Props): React.JSX.Element {
  const [mounted, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open)

  useEffect(() => {
    const animationFrames: number[] = []
    let unmountTimeout: ReturnType<typeof setTimeout> | undefined

    if (open) {
      // Collapse first, then expand on the next frames so the transition plays (also on mount).
      // oxlint-disable-next-line react/set-state-in-effect -- drives the CSS transition
      setMounted(true)
      setExpanded(false)
      animationFrames.push(
        requestAnimationFrame(() => {
          animationFrames.push(requestAnimationFrame(() => setExpanded(true)))
        }),
      )
    } else {
      setExpanded(false)
      animationFrames.push(
        requestAnimationFrame(() => {
          unmountTimeout = setTimeout(() => setMounted(false), COLLAPSE_DURATION_MS)
        }),
      )
    }

    return () => {
      for (const animationFrame of animationFrames) cancelAnimationFrame(animationFrame)
      if (unmountTimeout !== undefined) clearTimeout(unmountTimeout)
    }
  }, [open])

  return (
    <div
      aria-hidden={!open}
      style={{
        display: 'grid',
        gridTemplateRows: expanded ? '1fr' : '0fr',
        opacity: expanded ? 1 : 0,
        overflow: 'hidden',
        transition: `grid-template-rows ${COLLAPSE_DURATION_MS}ms ease, opacity ${COLLAPSE_DURATION_MS}ms ease`,
        willChange: 'grid-template-rows, opacity',
      }}
    >
      <div style={{minHeight: 0, overflow: 'hidden'}}>{mounted ? children(!open) : null}</div>
    </div>
  )
}
