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
  createSearch,
  DEFAULT_STUDIO_CLIENT_OPTIONS,
  getPublishedId,
  type Path,
  type SchemaType,
  SearchResultItemPreview,
  type Source,
  useClient,
  useFormValue,
  usePerspective,
  useSource,
  useTranslation,
} from 'sanity'

import {sortableTreeLocaleNamespace} from './i18n'
import {isRecord} from './utils'

type SanityClient = ReturnType<Source['getClient']>

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
  /** The reference type's `options` (its search `filter` and `filterParams`) */
  options?: ReferenceSearchOptions
  /** The reference's path in the document (for a `filter` function) */
  path: Path
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

/** The schema's reference `options`: `filter` (a GROQ string or a resolver) and `filterParams` */
interface ReferenceSearchOptions {
  filter?: unknown
  filterParams?: Record<string, unknown>
}

/** Search depth the Studio's reference input uses unless configured otherwise */
const MAX_FIELD_DEPTH = 5

/**
 * The schema's `options.filter`, resolved like the Studio's reference input does: a GROQ string
 * with `filterParams`, or a function of the document, the reference's parent and the perspective
 */
async function resolveFilter(
  options: ReferenceSearchOptions | undefined,
  context: {
    document: unknown
    path: Path
    perspective: string[]
    getClient: (options: {apiVersion: string}) => SanityClient
  },
): Promise<{filter?: string; params?: Record<string, unknown>; perspective?: string[]}> {
  if (!options) return {}
  if (typeof options.filter === 'function') {
    const parentPath = context.path.slice(0, -1)
    // oxlint-disable-next-line no-unsafe-type-assertion -- the schema's own filter resolver
    const resolver = options.filter as (context: Record<string, unknown>) => unknown
    const resolved: unknown = await resolver({
      document: context.document,
      parentPath,
      parent: getAt(context.document, parentPath),
      perspective: context.perspective,
      getClient: context.getClient,
    })
    return isRecord(resolved) ? resolved : {}
  }
  return typeof options.filter === 'string'
    ? {filter: options.filter, params: options.filterParams}
    : {}
}

/** The value at a path of keys, `_key` segments and indexes */
function getAt(value: unknown, path: Path): unknown {
  let current = value
  for (const segment of path) {
    if (Array.isArray(current)) {
      current =
        typeof segment === 'number'
          ? current[segment]
          : isRecord(segment) && '_key' in segment
            ? current.find((item: unknown) => isRecord(item) && item._key === segment._key)
            : undefined
    } else if (isRecord(current) && typeof segment === 'string') {
      current = current[segment]
    } else {
      return undefined
    }
  }
  return current
}

/**
 * Documents the reference can point to, from the Studio's own search (what its reference input
 * uses): every allowed type, the workspace's search strategy, each type's search configuration
 * and weights, the current perspective and the schema's `options.filter`
 */
function useReferenceTargets(
  to: SchemaType[],
  options: ReferenceSearchOptions | undefined,
  path: Path,
  query: string,
  enabled: boolean,
) {
  // The Studio's reference input reads the workspace's search strategy and client from it
  // oxlint-disable-next-line typescript/no-deprecated -- internal, like createSearch itself
  const source = useSource()
  const client = useMemo(() => source.getClient(DEFAULT_STUDIO_CLIENT_OPTIONS), [source])
  const {perspectiveStack} = usePerspective()
  const document = useFormValue([])
  const [result, setResult] = useState<{query: string; targets: ReferenceTarget[]} | null>(null)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    let unsubscribe = () => {}

    void resolveFilter(options, {
      document,
      path,
      perspective: perspectiveStack,
      getClient: source.getClient,
    })
      .then(({filter, params, perspective}) => {
        if (cancelled) return undefined
        const searchPerspective = perspective ?? perspectiveStack
        const search = createSearch(to, client, {
          filter,
          params,
          tag: 'search.reference',
          maxDepth: MAX_FIELD_DEPTH,
          strategy: source.search.strategy,
          perspective: searchPerspective,
        })
        const subscription = search(query.trim(), {
          perspective: searchPerspective,
          limit: LIMIT,
        }).subscribe({
          next: ({hits}) => {
            void withPublishedState(
              client,
              hits.map(({hit}) => hit),
            ).then((targets) => {
              if (!cancelled) setResult({query, targets})
              return undefined
            })
          },
          error: () => {
            if (!cancelled) setResult({query, targets: []})
          },
        })
        unsubscribe = () => subscription.unsubscribe()
        return undefined
      })
      .catch(() => {
        if (!cancelled) setResult({query, targets: []})
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [client, document, enabled, options, path, perspectiveStack, query, source, to])

  return result?.query === query ? result.targets : null
}

/** The hits as targets (by published id, without duplicates), marking those never published */
async function withPublishedState(
  client: SanityClient,
  hits: Array<{_id: string; _type?: string}>,
): Promise<ReferenceTarget[]> {
  const byId = new Map<string, ReferenceTarget>()
  for (const hit of hits) {
    const id = getPublishedId(hit._id)
    if (!byId.has(id) && hit._type) byId.set(id, {id, type: hit._type, draftOnly: true})
  }
  if (!byId.size) return []
  const published = await client
    .withConfig({perspective: 'raw'})
    .fetch<string[]>('*[_id in $ids]._id', {ids: [...byId.keys()]})
    .catch(() => [...byId.keys()])
  for (const id of published) {
    const target = byId.get(id)
    if (target) target.draftOnly = false
  }
  return [...byId.values()]
}

/**
 * The reference's search, like the color select plugin's field: an input that opens a popover
 * listing the documents it can point to, narrowed down as you type. Picking one sets the
 * reference; Escape or leaving the search keeps the current one.
 */
export function ReferenceSearch({to, options, path, autoFocus, readOnly, onPick, onDone}: Props) {
  const {t} = useTranslation(sortableTreeLocaleNamespace)
  const perspective = usePerspective()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const targets = useReferenceTargets(to, options, path, query, open)
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
