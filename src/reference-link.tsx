import {Box, Button} from '@sanity/ui'
import type {ReactNode} from 'react'
import type {Path} from 'sanity'
import {usePaneRouter} from 'sanity/structure'

interface Props {
  documentId: string
  documentType: string
  /** The reference's path in the document (the pane remembers which reference it was opened from) */
  path: Path
  disabled?: boolean
  /** Outside the structure tool (no panes to open): what a click does instead */
  onClick: () => void
  children: ReactNode
}

/** The row button's look, shared by the link and the plain button */
const BUTTON_PROPS = {
  mode: 'bleed',
  padding: 1,
  paddingX: 2,
  width: 'fill',
  style: {minHeight: 32},
} as const

/**
 * A picked reference's row button. In the structure tool it opens the referenced document in a
 * pane to the right, like the Studio's reference input (and the color select plugin's preset
 * reference), and stays selected while that pane is open. Elsewhere it's a plain button.
 */
export function ReferenceLinkButton({
  documentId,
  documentType,
  path,
  disabled,
  onClick,
  children,
}: Props): React.JSX.Element {
  const {ReferenceChildLink, groupIndex, routerPanesState} = usePaneRouter()
  // The pane router only has panes in the structure tool
  const inPanes = Array.isArray(routerPanesState) && routerPanesState.length > 0

  if (!inPanes || disabled) {
    return (
      <Button {...BUTTON_PROPS} disabled={disabled} onClick={onClick}>
        {children}
      </Button>
    )
  }

  const open = isReferencePaneOpen(routerPanesState, groupIndex, documentId)
  return (
    <Box flex={1} style={{minWidth: 0}}>
      <ReferenceChildLink documentId={documentId} documentType={documentType} parentRefPath={path}>
        {/* Inside the link, the button is only its look: primary (blue) while the pane is open, like
            the Studio's reference input and the color select plugin */}
        <Button
          {...BUTTON_PROPS}
          as="span"
          mode={open ? 'default' : 'bleed'}
          tone={open ? 'primary' : 'default'}
          data-open={open ? '' : undefined}
        >
          {children}
        </Button>
      </ReferenceChildLink>
    </Box>
  )
}

/** Whether the pane right of this one shows the referenced document */
function isReferencePaneOpen(
  routerPanesState: unknown[],
  groupIndex: number,
  documentId: string,
): boolean {
  const next = routerPanesState[groupIndex + 1]
  const siblings: unknown[] = Array.isArray(next) ? next : next ? [next] : []
  return siblings.some((sibling) => {
    if (typeof sibling !== 'object' || sibling === null) return false
    const id =
      'id' in sibling
        ? sibling.id
        : 'params' in sibling && typeof sibling.params === 'object' && sibling.params
          ? (sibling.params as {id?: unknown}).id
          : undefined
    return id === documentId
  })
}
