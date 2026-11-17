import {AddIcon} from '@sanity/icons/Add'
import {Button, Text} from '@sanity/ui'
import {Menu, MenuButton, MenuItem} from '@sanity/ui/menu'
import {Tooltip} from '@sanity/ui/tooltip'
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
      // As wide as its items and centered under the button, like the row's "Add nested item" menu
      popover={{portal: true, placement: 'bottom', fallbackPlacements: ['top']}}
    />
  )
}

export const NewTreeItem = memo(NewTreeItemComponent)

interface AddChildButtonProps {
  id: string
  onAdd: (id: string, typeName?: string) => void
  types: AddableType[]
}

/** Row action that adds a nested item, with a type menu when several types are allowed */
export function AddChildButton({id, onAdd, types}: AddChildButtonProps): React.JSX.Element {
  const {t} = useTranslation(sortableTreeLocaleNamespace)
  const menuId = useId()

  const button = (
    <Button
      aria-label={t('add-child')}
      icon={AddIcon}
      mode="bleed"
      padding={2}
      onClick={types.length > 1 ? undefined : () => onAdd(id)}
    />
  )

  return (
    <Tooltip
      content={
        <Text muted size={1}>
          {t('add-child')}
        </Text>
      }
      animate
      fallbackPlacements={['right', 'left']}
      placement="top"
      portal
    >
      {types.length > 1 ? (
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
                  onClick={() => onAdd(id, type.name)}
                />
              ))}
            </Menu>
          }
          popover={{portal: true, placement: 'bottom-end'}}
        />
      ) : (
        button
      )}
    </Tooltip>
  )
}
