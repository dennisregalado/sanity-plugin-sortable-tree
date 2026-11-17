import {createContext, memo, useContext, useMemo} from 'react'
import {
  ArrayOfObjectsItem,
  type ArrayOfObjectsItemMember,
  type ItemProps,
  type Path,
  type PreviewProps,
  type RenderAnnotationCallback,
  type RenderArrayOfObjectsItemCallback,
  type RenderBlockCallback,
  type RenderFieldCallback,
  type RenderInputCallback,
  type RenderPreviewCallback,
  useTranslation,
} from 'sanity'

import {sortableTreeLocaleNamespace} from './i18n'
import type {PatchInput} from './patches'

/** The form render callbacks an array item needs */
export interface RenderCallbacks {
  renderAnnotation?: RenderAnnotationCallback
  renderBlock?: RenderBlockCallback
  renderField: RenderFieldCallback
  renderInlineBlock?: RenderBlockCallback
  renderInput: RenderInputCallback
  renderItem: RenderArrayOfObjectsItemCallback
  renderPreview: RenderPreviewCallback
}

/** Renders only the item's preview (the tree row provides the rest) */
function TreeItemInput(props: ItemProps) {
  if (!('inputProps' in props)) return props.renderDefault(props)

  const {inputProps} = props
  return inputProps.renderPreview(inputProps)
}

/**
 * Focus handling for an item input shown in a tree row. The form's own `onPathFocus` also opens
 * the focused path's parent, which for a nested item means the dialog of the item holding it: in
 * the row, focus stays local instead.
 */
export interface RowFocus {
  focusPath: Path
  onPathFocus: (path: Path) => void
  /**
   * Applies the input's patches (relative to the item). The item's own `onChange` hands them to the
   * root array, which is wrong for nested items: the tree puts them at the item's full path.
   */
  onChange: (patches: PatchInput) => void
}

const RowFocusContext = createContext<RowFocus | null>(null)

const noCreateTypes = new WeakMap<object, object>()

/**
 * The reference type with `options.disableNew`, which hides the reference input's "Create" button:
 * the row only picks existing documents. Cached, so the input sees a stable schema type.
 */
function withoutCreate<T extends {options?: object}>(schemaType: T): T {
  let type = noCreateTypes.get(schemaType)
  if (!type) {
    type = {...schemaType, options: {...schemaType.options, disableNew: true}}
    noCreateTypes.set(schemaType, type)
  }
  // oxlint-disable-next-line no-unsafe-type-assertion -- the same type, with one option added
  return type as T
}

/** Renders only the item's input (the Studio's reference search), with the row's focus handling */
function TreeItemField(props: ItemProps) {
  const rowFocus = useContext(RowFocusContext)
  if (!('inputProps' in props) || !rowFocus) return <>{props.children}</>

  const {inputProps} = props
  const rowInputProps = {
    ...inputProps,
    schemaType: withoutCreate(inputProps.schemaType),
    focusPath: rowFocus.focusPath,
    focused: rowFocus.focusPath.length > 0,
    onPathFocus: rowFocus.onPathFocus,
    onChange: rowFocus.onChange,
    elementProps: {...inputProps.elementProps, onFocus: () => rowFocus.onPathFocus(['_ref'])},
  }
  return inputProps.renderInput(rowInputProps)
}

/** The Studio's own preview of the item, in the compact layout */
function TreeItemPreview(props: PreviewProps) {
  const {t} = useTranslation(sortableTreeLocaleNamespace)

  return props.renderDefault({
    ...props,
    layout: 'compact',
    title: props.title || t('untitled'),
    subtitle: undefined,
    description: undefined,
  })
}

interface MemberPreviewProps {
  member: ArrayOfObjectsItemMember
  callbacks: RenderCallbacks
  /** Show the item's input instead of its preview, with this focus handling (for references) */
  rowFocus?: RowFocus
}

/**
 * An array member rendered through the Studio's item pipeline, showing just its preview (or, with
 * `showInput`, just its input)
 */
export const MemberPreview = memo(function MemberPreview({
  member,
  callbacks,
  rowFocus,
}: MemberPreviewProps) {
  const showInput = rowFocus !== undefined
  const previewMember = useMemo(
    () => ({
      ...member,
      item: {
        ...member.item,
        schemaType: {
          ...member.item.schemaType,
          components: {
            ...member.item.schemaType.components,
            item: showInput ? TreeItemField : TreeItemInput,
            preview: TreeItemPreview,
          },
        },
      },
    }),
    [member, showInput],
  )

  const item = <ArrayOfObjectsItem member={previewMember} {...callbacks} />
  return showInput ? (
    <RowFocusContext.Provider value={rowFocus}>{item}</RowFocusContext.Provider>
  ) : (
    item
  )
})
