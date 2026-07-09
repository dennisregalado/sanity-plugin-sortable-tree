export interface Item {
  _key: string
  _type?: string
  children?: Item[]
  collapsed?: boolean
}

export interface FlattenedItem extends Item {
  id: string
  parentId: string | null
  depth: number
  index: number
}
