import {useSyncExternalStore} from 'react'

const QUERY = '(hover: hover)'

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** Whether the primary pointer can hover (false on touch screens) */
export function useCanHover(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    // Assume a mouse when rendering on the server
    () => true,
  )
}
