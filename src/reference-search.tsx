import {SearchIcon} from '@sanity/icons/Search'
import {
  Box,
  Button,
  Card,
  Flex,
  Spinner,
  Stack,
  Text,
  TextInput,
  useClickOutsideEvent,
} from '@sanity/ui'
import {Popover} from '@sanity/ui/popover'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  type SchemaType,
  SearchResultItemPreview,
  useClient,
  usePerspective,
  useTranslation,
} from 'sanity'

import {sortableTreeLocaleNamespace} from './i18n'

const API_VERSION = '2025-02-19'
/** Height of a row's preview button (a compact preview in a `padding={1}` bleed button) */
export const ROW_PREVIEW_HEIGHT = 41
/** Documents listed before anything is typed, and matches listed for a search */
const LIMIT = 20

/** The search icon, centered on the preview's media (left 4px, 25px wide) */
const ICON_STYLE: React.CSSProperties = {
  position: 'absolute',
  zIndex: 1,
  top: 0,
  bottom: 0,
  left: 4,
  width: 25,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 21,
  color: 'var(--card-muted-fg-color)',
  pointerEvents: 'none',
}

/** See the input's `style` */
const INPUT_STYLE: React.CSSProperties = {height: ROW_PREVIEW_HEIGHT, paddingLeft: 37}

/** A document the reference can point to */
export interface ReferenceTarget {
  /** Published id (what `_ref` holds) */
  id: string
  type: string
  /** Only a draft exists: the reference has to be weak until it's published */
  draftOnly: boolean
}

interface Props {
  /** The types the reference can point to (`schemaType.to`) */
  to: SchemaType[]
  /** Focus the search when it mounts */
  autoFocus?: boolean
  readOnly?: boolean
  onPick: (target: ReferenceTarget) => void
  /** Escape, or focus left the search without picking */
  onDone: () => void
}

/**
 * The referenced document's type, if it exists (as a draft or published) and is a type the
 * reference allows, like the Studio's reference input checks: `null` if not, `undefined` while
 * loading or without an id
 */
export function useReferencedType(
  documentId: string | undefined,
  to: SchemaType[],
): string | null | undefined {
  const client = useClient({apiVersion: API_VERSION})
  const allowedKey = to.map((type) => type.name).join('|')
  const [result, setResult] = useState<{id: string; type: string | null}>()

  useEffect(() => {
    if (!documentId) return undefined
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

  if (!documentId || result?.id !== documentId) return undefined
  return result.type && allowedKey.split('|').includes(result.type) ? result.type : null
}

/**
 * Like the link picker: keep focus in the input while clicking inside the popover. Otherwise the
 * input's blur would end the search before the click lands.
 */
const keepInputFocus = (event: React.MouseEvent) => event.preventDefault()

const isFieldPath = (field: unknown): field is string =>
  typeof field === 'string' && /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(field)

/** The fields searched for each type: what its preview shows as the title */
function getTitleFields(to: SchemaType[]): string[] {
  const fields = to.map((type) => {
    const select: unknown = type.preview?.select
    const title =
      typeof select === 'object' && select !== null && 'title' in select ? select.title : 'title'
    // `link.title` style selections follow a reference: search the document's own title instead
    return isFieldPath(title) && !title.includes('.') ? title : 'title'
  })
  return [...new Set(fields)]
}

/** Documents of the allowed types, newest first, whose title matches every word typed */
function useReferenceTargets(to: SchemaType[], query: string, enabled: boolean) {
  const client = useClient({apiVersion: API_VERSION})
  const types = useMemo(() => to.map((type) => type.name), [to])
  const titleFields = useMemo(() => getTitleFields(to), [to])
  const [result, setResult] = useState<{key: string; targets: ReferenceTarget[]} | null>(null)
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word}*`)
  const key = `${types.join(',')}|${terms.join(' ')}`

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const filter = terms.length
      ? ` && (${titleFields.map((field) => `${field} match $terms`).join(' || ')})`
      : ''
    // Drafts and published documents (not release versions), merged by published id below
    const groq = `*[_type in $types && !(_id in path("versions.**"))${filter}] | order(_updatedAt desc) [0...${LIMIT * 2}] {_id, _type}`

    void client
      .fetch<Array<{_id: string; _type: string}>>(groq, {types, terms})
      .then(
        (documents) => {
          const byId = new Map<string, ReferenceTarget>()
          for (const document of documents) {
            const isDraft = document._id.startsWith('drafts.')
            const id = isDraft ? document._id.slice('drafts.'.length) : document._id
            const known = byId.get(id)
            if (known) {
              if (!isDraft) known.draftOnly = false
              continue
            }
            byId.set(id, {id, type: document._type, draftOnly: isDraft})
          }
          return [...byId.values()].slice(0, LIMIT)
        },
        () => [],
      )
      .then((targets) => {
        if (!cancelled) setResult({key, targets})
        return undefined
      })
    return () => {
      cancelled = true
    }
    // `key` covers `types` and `terms`
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [client, enabled, key, titleFields])

  return result?.key === key ? result.targets : null
}

/**
 * The reference's search, like the color select plugin's field: an input that opens a popover
 * listing the documents it can point to, narrowed down as you type. Picking one sets the
 * reference; Escape or leaving the search keeps the current one.
 */
export function ReferenceSearch({to, autoFocus, readOnly, onPick, onDone}: Props) {
  const {t} = useTranslation(sortableTreeLocaleNamespace)
  const perspective = usePerspective()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const targets = useReferenceTargets(to, query, open)
  const typeByName = useMemo(() => new Map(to.map((type) => [type.name, type])), [to])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActive(0)
    onDone()
  }, [onDone])

  useClickOutsideEvent(open && close, () => [container, popoverRef.current])

  const pick = useCallback(
    (target: ReferenceTarget) => {
      setOpen(false)
      setQuery('')
      setActive(0)
      onPick(target)
    },
    [onPick],
  )

  const heading = query.trim()
    ? targets === null
      ? t('reference.searching')
      : t('reference.results', {count: targets.length})
    : to.length === 1
      ? to[0]?.title || to[0]?.name
      : t('reference.documents')

  const list =
    targets === null ? (
      <Flex justify="center" padding={3}>
        <Spinner muted />
      </Flex>
    ) : targets.length === 0 ? (
      <Box paddingX={2} paddingBottom={3}>
        <Text size={1} muted>
          {query.trim() ? t('reference.no-matches', {query: query.trim()}) : t('reference.none')}
        </Text>
      </Box>
    ) : (
      <Stack gap={1}>
        {targets.map((target, index) => {
          const schemaType = typeByName.get(target.type)
          if (!schemaType) return null
          return (
            <Button
              key={target.id}
              mode="bleed"
              width="fill"
              padding={1}
              selected={index === active}
              onMouseDown={keepInputFocus}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(target)}
            >
              <SearchResultItemPreview
                documentId={target.id}
                documentType={target.type}
                layout={query.trim() ? 'default' : 'compact'}
                perspective={perspective.perspectiveStack}
                schemaType={schemaType}
                showBadge={false}
              />
            </Button>
          )
        })}
      </Stack>
    )

  return (
    <Box ref={setContainer} flex={1} style={{minWidth: 0, position: 'relative'}}>
      <Popover
        open={open && !readOnly}
        // Not the row's validation tone
        tone="default"
        referenceElement={container}
        portal
        placement="bottom-start"
        fallbackPlacements={['top-start']}
        animate
        constrainSize
        radius={4}
        shadow={3}
        content={
          <Card
            ref={popoverRef}
            padding={1}
            radius={4}
            style={{width: 340, maxHeight: 'inherit', overflow: 'auto'}}
          >
            <Stack gap={1}>
              <Box paddingX={2} paddingY={3}>
                <Text size={1} weight="medium">
                  {heading}
                </Text>
              </Box>
              {list}
            </Stack>
          </Card>
        }
      />
      {/* Where the picked reference's preview shows its media, centered in the taller input (the
          input's own icon slot is sized for its default height), like the color select plugin's
          swatch */}
      <span aria-hidden style={ICON_STYLE}>
        <SearchIcon />
      </span>
      <TextInput
        ref={inputRef}
        fontSize={1}
        weight="medium"
        readOnly={readOnly}
        placeholder={t('reference.search')}
        aria-label={t('reference.search')}
        // The size of the picked reference's preview button it replaces, with the text where the
        // preview's title starts, so the row keeps its height and nothing shifts
        style={INPUT_STYLE}
        value={query}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.currentTarget.value)
          setActive(0)
          setOpen(true)
        }}
        onBlur={(event) => {
          // Clicks in the popover keep focus in the input; anything else ends the search
          if (!popoverRef.current?.contains(event.relatedTarget)) close()
        }}
        onKeyDown={(event) => {
          const count = targets?.length ?? 0
          if (event.key === 'ArrowDown' && count) {
            event.preventDefault()
            setOpen(true)
            setActive((index) => (index + 1) % count)
          } else if (event.key === 'ArrowUp' && count) {
            event.preventDefault()
            setActive((index) => (index - 1 + count) % count)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            const target = targets?.[active]
            if (open && target) pick(target)
          } else if (event.key === 'Escape') {
            event.stopPropagation()
            close()
          }
        }}
      />
    </Box>
  )
}
