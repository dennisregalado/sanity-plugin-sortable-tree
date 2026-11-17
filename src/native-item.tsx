import {createContext, memo, useContext, useMemo} from 'react'
import {
  ArrayOfObjectsItem,
  type ArrayOfObjectsItemMember,
  type ArraySchemaType,
  type ItemProps,
  type ObjectItemProps,
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

/** An action of `options.disableActions` */
export type ArrayAction = NonNullable<
  NonNullable<ArraySchemaType['options']>['disableActions']
>[number]

/** The event of the item menu's Duplicate and Add item before/after */
export type InsertEvent = Parameters<ObjectItemProps['onInsert']>[0]

/**
 * What a tree row's native item needs from the tree. The Studio's own item actions only work for
 * root rows: nested rows are rendered in the root array's form context, so their removes and
 * inserts would patch the root array. The tree knows every item's real path and handles them.
 */
export interface TreeRowActions {
  /**
   * Only root rows host the edit dialog. A nested item opens in its root ancestor's dialog (an item
   * is open whenever an item inside it is), stacked like in the Studio's own array input.
   */
  isRoot: boolean
  /** The tree's `options.disableActions`, which apply to every row of the tree */
  disabledActions: readonly ArrayAction[]
  onOpen: () => void
  onRemove: () => void
  /** Inserts siblings of the item (Duplicate, Add item before/after) */
  onInsert: (event: InsertEvent) => void
}

const TreeRowContext = createContext<TreeRowActions | null>(null)

export const TreeRowProvider = TreeRowContext.Provider

const nativeParentTypes = new WeakMap<object, WeakMap<readonly ArrayAction[], ArraySchemaType>>()

/**
 * The item's array type as the native item should see it: without the Studio's own drag handle
 * (`sortable: false`, the tree draws its own), and with the tree's disabled actions. Cached, so rows
 * re-render with the same object.
 */
function getNativeParentType(
  parentType: ArraySchemaType,
  disabledActions: readonly ArrayAction[],
): ArraySchemaType {
  let byActions = nativeParentTypes.get(parentType)
  if (!byActions) {
    byActions = new WeakMap()
    nativeParentTypes.set(parentType, byActions)
  }

  let nativeType = byActions.get(disabledActions)
  if (!nativeType) {
    const own = parentType.options?.disableActions ?? []
    nativeType = {
      ...parentType,
      options: {
        ...parentType.options,
        sortable: false,
        disableActions: [...new Set([...own, ...disabledActions])],
      },
    }
    byActions.set(disabledActions, nativeType)
  }
  return nativeType
}

function isObjectItemProps(props: ItemProps): props is ObjectItemProps {
  return 'inputProps' in props && 'onOpen' in props
}

/**
 * A tree row's item: the Studio's own (card, presence, validation, item menu, change indicator and
 * edit dialog), with the tree's actions
 */
function TreeNativeItem(props: ItemProps) {
  const row = useContext(TreeRowContext)
  if (!row || !isObjectItemProps(props)) return props.renderDefault(props)

  return props.renderDefault({
    ...props,
    parentSchemaType: getNativeParentType(props.parentSchemaType, row.disabledActions),
    open: row.isRoot && props.open,
    onOpen: row.onOpen,
    onRemove: row.onRemove,
    onInsert: row.onInsert,
    // The dialog's content is a regular form: its own items aren't tree rows
    children: <TreeRowContext.Provider value={null}>{props.children}</TreeRowContext.Provider>,
  })
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

interface NativeItemProps {
  member: ArrayOfObjectsItemMember
  callbacks: RenderCallbacks
}

/** An array member rendered as a Studio array item, through the Studio's item pipeline */
export const NativeItem = memo(function NativeItem({member, callbacks}: NativeItemProps) {
  const nativeMember = useMemo(
    () => ({
      ...member,
      item: {
        ...member.item,
        schemaType: {
          ...member.item.schemaType,
          components: {
            ...member.item.schemaType.components,
            item: TreeNativeItem,
            preview: TreeItemPreview,
          },
        },
      },
    }),
    [member],
  )

  return <ArrayOfObjectsItem member={nativeMember} {...callbacks} />
})
