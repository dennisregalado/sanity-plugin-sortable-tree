/**
 * Documents served by the fake Content Lake. Keys are fixed so screenshots and tests are stable.
 */

const item = (key, title, url, children) => ({
  _key: key,
  _type: 'menuItem',
  title,
  url,
  ...(children ? {children} : {}),
})

const mainMenu = [
  item('home', 'Home', '/'),
  item('shop', 'Shop', '/shop', [
    item('women', 'Women', '/shop/women', [
      item('dresses', 'Dresses', '/shop/women/dresses'),
      item('shoes', 'Shoes', '/shop/women/shoes'),
    ]),
    item('men', 'Men', '/shop/men'),
    item('sale', 'Sale', '/shop/sale'),
  ]),
  item('about', 'About', '/about', [item('team', 'Team', '/about/team')]),
  item('contact', 'Contact', '/contact'),
]

function bigMenu(count) {
  const items = []
  for (let i = 0; i < count / 5; i++) {
    items.push(
      item(`g${i}`, `Group ${i + 1}`, `/g/${i}`, [
        item(`g${i}a`, `Group ${i + 1} · A`, `/g/${i}/a`),
        item(`g${i}b`, `Group ${i + 1} · B`, `/g/${i}/b`, [
          item(`g${i}b1`, `Group ${i + 1} · B · 1`, `/g/${i}/b/1`),
          item(`g${i}b2`, `Group ${i + 1} · B · 2`, `/g/${i}/b/2`),
        ]),
      ]),
    )
  }
  return items
}

export const fixtures = [
  {_id: 'menu-main', _type: 'menu', title: 'Main menu', items: mainMenu},
  {_id: 'menu-empty', _type: 'menu', title: 'Empty menu', items: []},
  {
    _id: 'menu-validation',
    _type: 'menu',
    title: 'Validation',
    items: [
      item('home', 'Home', '/'),
      item('shop', 'Shop', '/shop', [{_key: 'untitled', _type: 'menuItem', url: '/shop/new'}]),
      item('about', 'About', '/about', [{_key: 'untitled2', _type: 'menuItem', url: '/about/x'}]),
      item('contact', 'Contact', '/contact'),
    ],
  },
  {
    _id: 'menu-options',
    _type: 'optionsMenu',
    title: 'sortable: false, disableActions: add, remove',
    items: mainMenu,
  },
  {_id: 'menu-readonly', _type: 'readOnlyMenu', title: 'Read-only menu', items: mainMenu},
  {
    _id: 'menu-named',
    _type: 'namedMenu',
    title: 'Named array type',
    items: mainMenu,
  },
  {
    _id: 'menu-mixed',
    _type: 'mixedMenu',
    title: 'Mixed item types',
    items: [
      item('home', 'Home', '/'),
      {_key: 'divider', _type: 'menuDivider', label: 'Divider'},
      item('shop', 'Shop', '/shop', [item('men', 'Men', '/shop/men')]),
    ],
  },
  {
    _id: 'menu-fields',
    _type: 'fieldsMenu',
    title: 'Fields named like tree bookkeeping',
    items: [
      {
        _key: 'a',
        _type: 'fieldsItem',
        title: 'A',
        id: 'products',
        index: 7,
        depth: 'deep',
        parentId: 'x',
        collapsed: true,
        children: [{_key: 'a1', _type: 'fieldsItem', title: 'A1', id: 'shoes'}],
      },
      {_key: 'b', _type: 'fieldsItem', title: 'B', id: 'about'},
      {_key: 'c', _type: 'fieldsItem', title: 'C', id: 'contact'},
    ],
  },
  {
    _id: 'menu-malformed',
    _type: 'menu',
    title: 'Malformed nested data',
    items: [
      item('ok', 'Fine item', '/'),
      {...item('bad-children', 'Children is a string', '/x'), children: 'oops'},
      item('missing-keys', 'Children missing keys', '/y', [
        {_type: 'menuItem', title: 'No key 1'},
        {_type: 'menuItem', title: 'No key 2'},
      ]),
    ],
  },
  {_id: 'menu-big', _type: 'menu', title: '500 items', items: bigMenu(500)},
]
