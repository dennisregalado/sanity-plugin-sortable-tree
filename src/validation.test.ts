import {describe, expect, it} from 'vitest'

import {collectValidation} from './validation'

const marker = (message: string, level: 'error' | 'warning' = 'error') => ({
  level,
  message,
  path: [],
})

// A trimmed-down item form node: a title field, a fieldset with a url field, and children
const node = {
  validation: [],
  members: [
    {kind: 'field', name: 'title', field: {validation: [marker('Required')]}},
    {
      kind: 'fieldSet',
      fieldSet: {
        members: [
          {kind: 'field', name: 'url', field: {validation: [marker('Bad URL', 'warning')]}},
        ],
      },
    },
    {
      kind: 'field',
      name: 'children',
      field: {
        validation: [],
        members: [
          {
            kind: 'item',
            item: {
              validation: [],
              members: [
                {kind: 'field', name: 'title', field: {validation: [marker('Child required')]}},
              ],
            },
          },
        ],
      },
    },
  ],
}

describe('collectValidation', () => {
  it("collects the item's field markers, including fieldsets, but not its children", () => {
    expect(collectValidation(node, false).map((m) => m.message)).toEqual(['Required', 'Bad URL'])
  })

  it('includes nested children when asked (collapsed items)', () => {
    expect(collectValidation(node, true).map((m) => m.message)).toEqual([
      'Required',
      'Bad URL',
      'Child required',
    ])
  })

  it('ignores anything that is not a form node', () => {
    expect(collectValidation(undefined, true)).toEqual([])
    expect(collectValidation({members: [null, 'x', {kind: 'error'}]}, true)).toEqual([])
  })
})
