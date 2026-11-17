import {AddIcon} from '@sanity/icons/Add'
import {Button} from '@sanity/ui'
import {Menu, MenuButton, MenuItem} from '@sanity/ui/menu'
import {type ComponentType, memo, type ReactNode, useCallback, useId} from 'react'
import {useTranslation} from 'sanity'

import {sortableTreeLocaleNamespace} from './i18n'

/** An item type that can be added to a list */
export interface AddableType {
  name: string
  title: string
  icon?: ComponentType | ReactNode
}

interface Props {
  addItem: (parentId: string | null, typeName?: string) => void
  disabled?: boolean
  parentId?: string | null
  /** The item types the list accepts: with more than one, the button opens a menu */
  types?: AddableType[]
}

const NO_TYPES: AddableType[] = []

function NewTreeItemComponent({
  addItem,
  disabled = false,
  parentId = null,
  types = NO_TYPES,
}: Props) {
  const {t} = useTranslation(sortableTreeLocaleNamespace)
  const menuId = useId()
  const handleClick = useCallback(() => {
    addItem(parentId)
  }, [addItem, parentId])

  const button = (
    <Button
      disabled={disabled}
      mode="ghost"
      icon={AddIcon}
      text={t('add-item')}
      onClick={types.length > 1 ? undefined : handleClick}
      width="fill"
      padding={2}
    />
  )

  if (types.length <= 1) return button

  return (
    <MenuButton
      id={menuId}
      button={button}
      menu={
        <Menu>
          {types.map((type) => (
            <MenuItem
              key={type.name}
              icon={type.icon}
              text={type.title}
              onClick={() => addItem(parentId, type.name)}
            />
          ))}
        </Menu>
      }
      popover={{
        portal: true,
        placement: 'bottom',
        fallbackPlacements: ['top'],
        matchReferenceWidth: true,
      }}
    />
  )
}

export const NewTreeItem = memo(NewTreeItemComponent)
