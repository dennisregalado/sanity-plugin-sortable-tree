import {ChevronDownIcon, DragHandleIcon} from '@sanity/icons'
import {memo, useMemo} from 'react'
import type React from 'react'
import {FlattenedItem} from './types'
import {Box, Button, Card, Flex, Text} from '@sanity/ui'

interface Props {
  descendants: FlattenedItem[]
  hasChildren?: boolean
  item?: FlattenedItem | null
  preview?: React.ReactNode
}

function TreeItemOverlayComponent({descendants, hasChildren, item, preview}: Props) {
  const totalChildren = useMemo(() => {
    return descendants.length + 1
  }, [descendants])

  if (!item) return null

  return (
    <Card padding={2} radius={2} shadow={2} style={{width: '100%'}} data-overlay>
      <Flex align="center" gap={1} style={{width: '100%'}}>
        <Button disabled paddingX={2} mode="bleed" icon={DragHandleIcon} />
        {hasChildren && <Button disabled paddingX={2} mode="bleed" icon={ChevronDownIcon} />}
        <Box flex={1} style={{marginLeft: -8, minWidth: 0}}>
          {preview}
        </Box>
        {totalChildren > 1 && (
          <Text muted size={1}>
            {totalChildren} items
          </Text>
        )}
      </Flex>
    </Card>
  )
}

export const TreeItemOverlay = memo(TreeItemOverlayComponent)
