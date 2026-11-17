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

// Items with an untitled (invalid) child each under "Shop" and "About"
const validationItems = [
  item('home', 'Home', '/'),
  item('shop', 'Shop', '/shop', [{_key: 'untitled', _type: 'menuItem', url: '/shop/new'}]),
  item('about', 'About', '/about', [{_key: 'untitled2', _type: 'menuItem', url: '/about/x'}]),
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

const page = (id, title, slug) => ({_id: id, _type: 'page', title, slug})
const ref = (key, id, extra) => ({_key: key, _type: 'reference', _ref: id, ...extra})
const navItem = (key, title, link, children) => ({
  _key: key,
  _type: 'navItem',
  title,
  ...(link ? {link: {_type: 'reference', _ref: link}} : {}),
  ...(children ? {children} : {}),
})

// Menu items and references to pages, mixed at every level
const pageMenu = [
  ref('ref-home', 'page-home'),
  navItem('products', 'Products', 'page-products', [
    ref('ref-shoes', 'page-shoes'),
    ref('ref-bags', 'page-bags'),
    navItem('more', 'More', null, [ref('ref-sale', 'page-sale')]),
  ]),
  navItem('company', 'Company', null, [
    ref('ref-about', 'page-about', {_weak: true, _strengthenOnPublish: {type: 'page'}}),
    // A reference to a document that doesn't exist
    ref('ref-missing', 'page-deleted'),
  ]),
  // A reference with no document picked yet
  {_key: 'ref-empty', _type: 'reference'},
  ref('ref-contact', 'page-contact'),
]

export const fixtures = [
  page('page-home', 'Home', '/'),
  page('page-products', 'Products', '/products'),
  page('page-shoes', 'Shoes', '/products/shoes'),
  page('page-bags', 'Bags', '/products/bags'),
  page('page-sale', 'Sale', '/sale'),
  page('page-about', 'About us', '/about'),
  page('page-contact', 'Contact', '/contact'),
  page('page-journal', 'Journal', '/journal'),
  {_id: 'menu-pages', _type: 'pageMenu', title: 'Pages and menu items', items: pageMenu},
  {_id: 'prod-sneaker', _type: 'product', title: 'Sneaker', sku: 'SNK-1'},
  {_id: 'prod-tote', _type: 'product', title: 'Tote bag', sku: 'TOTE-2'},
  // Only drafts: a reference to one is weak until it's published
  {_id: 'drafts.prod-hat', _type: 'product', title: 'Draft hat', sku: 'HAT-3'},
  {
    _id: 'menu-links',
    _type: 'linkMenu',
    title: 'Links to pages and products',
    items: [
      // A menu item without children: its row's "+" offers the menu item and page reference types
      navItem('shop', 'Shop', null),
      {_key: 'link-home', _type: 'link', _ref: 'page-home'},
      {_key: 'link-sneaker', _type: 'link', _ref: 'prod-sneaker'},
      {_key: 'weak-about', _type: 'weakPage', _ref: 'page-about', _weak: true},
    ],
  },
  {_id: 'menu-main', _type: 'menu', title: 'Main menu', items: mainMenu},
  {_id: 'menu-empty', _type: 'menu', title: 'Empty menu', items: []},
  {
    _id: 'menu-validation',
    _type: 'menu',
    title: 'Validation',
    items: validationItems,
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
  // The Studio's own array input with the same items, as a reference for dragging
  {_id: 'menu-native', _type: 'nativeMenu', title: 'Native array input', items: mainMenu},
  {
    _id: 'menu-native-validation',
    _type: 'nativeMenu',
    title: 'Native array input with validation',
    items: validationItems,
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
