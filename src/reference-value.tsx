import {EditIcon} from '@sanity/icons/Edit'
import {Box, Button, Card, Flex, Text} from '@sanity/ui'
import {Tooltip} from '@sanity/ui/tooltip'
import {memo, useEffect, useState} from 'react'
import {
  type Path,
  SanityDefaultPreview,
  type SchemaType,
  SearchResultItemPreview,
  useClient,
  usePerspective,
  useTranslation,
} from 'sanity'
import {usePaneRouter} from 'sanity/structure'

import {sortableTreeLocaleNamespace} from './i18n'

interface Props {
  /** The referenced document's (published) id */
  documentId: string
  /** The types the reference can point to (`schemaType.to`) */
  to: SchemaType[]
  /** Path of the reference, relative to the document (for the pane it opens) */
  path: Path
  disabled?: boolean
  onReplace: () => void
}

/** `undefined` while loading, `null` when the document doesn't exist (or can't be read) */
type DocumentType = string | null | undefined

/** Finds the referenced document's type, and whether it exists at all */
function useDocumentType(documentId: string, to: SchemaType[]): DocumentType {
  const client = useClient({apiVersion: '2025-02-19'})
  const allowedTypes = to.map((type) => type.name).filter(Boolean)
  const allowedKey = allowedTypes.join('|')
  const [result, setResult] = useState<{id: string; type: string | null}>()

  useEffect(() => {
    let cancelled = false
    void client
      .fetch<string | null>('*[_id in [$id, "drafts." + $id]][0]._type', {id: documentId})
      .then(
        (type) => type ?? null,
        () => null,
      )
      .then((type) => {
        if (!cancelled) setResult({id: documentId, type})
        return undefined
      })
    return () => {
      cancelled = true
    }
  }, [client, documentId])

  if (result?.id !== documentId) return undefined
  // A type the reference doesn't allow counts as unavailable, like the Studio's reference input
  return result.type && allowedKey.split('|').includes(result.type) ? result.type : null
}

/**
 * A picked reference, shown like the link picker plugin's selected reference: the document's
 * preview (with its status) in a bordered box that opens it in a pane, and a pencil that replaces
 * it with the Studio's reference search.
 */
function ReferenceValueComponent({documentId, to, path, disabled, onReplace}: Props) {
  const {t} = useTranslation(sortableTreeLocaleNamespace)
  const perspective = usePerspective()
  const {ReferenceChildLink, groupIndex, routerPanesState} = usePaneRouter()
  const documentType = useDocumentType(documentId, to)
  const refType = documentType ? to.find((type) => type.name === documentType) : undefined
  // The pane router only exists in the structure tool: elsewhere the preview isn't a link
  const inPanes = Array.isArray(routerPanesState) && routerPanesState.length > 0
  const paneOpen = inPanes && isReferencePaneOpen(routerPanesState, groupIndex, documentId)

  let preview: React.ReactNode
  if (documentType === undefined) {
    preview = (
      <Box style={{width: '100%'}}>
        <SanityDefaultPreview isPlaceholder layout="compact" />
      </Box>
    )
  } else if (documentType && refType) {
    preview = (
      <SearchResultItemPreview
        documentId={documentId}
        documentType={documentType}
        layout="compact"
        perspective={perspective.perspectiveStack}
        schemaType={refType}
        showBadge={false}
      />
    )
  } else {
    preview = (
      <Box paddingX={2} paddingY={2}>
        <Text muted size={1} textOverflow="ellipsis">
          {t('reference.unavailable')}
        </Text>
      </Box>
    )
  }

  const isLink = Boolean(documentType && inPanes)
  const buttonStyle = {clipPath: 'inset(3px round 2px)'}
  // Inside the pane link, the button is just its look (a span); otherwise it does nothing
  const button = isLink ? (
    <Button
      as="span"
      mode={paneOpen ? 'default' : 'bleed'}
      tone={paneOpen ? 'primary' : 'default'}
      padding={0}
      width="fill"
      style={buttonStyle}
    >
      {preview}
    </Button>
  ) : (
    <Button disabled mode="bleed" padding={0} width="fill" style={buttonStyle}>
      {preview}
    </Button>
  )

  return (
    <Card border radius={2} overflow="hidden" flex={1} style={{minWidth: 0}}>
      <Flex align="center" style={{height: 33}}>
        <Box flex={1} style={{minWidth: 0}}>
          {isLink && documentType ? (
            <ReferenceChildLink
              documentId={documentId}
              documentType={documentType}
              parentRefPath={path}
            >
              {button}
            </ReferenceChildLink>
          ) : (
            button
          )}
        </Box>
        {!disabled && (
          <Tooltip
            animate
            content={
              <Text muted size={1}>
                {t('reference.replace')}
              </Text>
            }
            placement="top"
            portal
          >
            <Button
              aria-label={t('reference.replace')}
              icon={EditIcon}
              mode="bleed"
              style={{clipPath: 'inset(3px round 2px)'}}
              onClick={onReplace}
            />
          </Tooltip>
        )}
      </Flex>
    </Card>
  )
}

export const ReferenceValue = memo(ReferenceValueComponent)

/** Whether the pane right of this one shows the referenced document */
function isReferencePaneOpen(
  routerPanesState: unknown[],
  groupIndex: number,
  documentId: string,
): boolean {
  const next = routerPanesState[groupIndex + 1]
  const siblings = Array.isArray(next) ? next : next ? [next] : []
  return siblings.some((sibling: {id?: string; params?: {id?: string}}) => {
    const id = sibling?.id ?? sibling?.params?.id
    return id === documentId
  })
}
