/**
 * A tiny in-memory stand-in for the Sanity Content Lake, so the test Studio runs offline with
 * deterministic data (no project, token or network needed).
 *
 * It implements just enough of the HTTP API for the Studio form: current user, dataset grants,
 * document fetch, GROQ queries (via groq-js), listeners (SSE, with mendoza effects) and
 * mutations/actions (via @sanity/mutator). Unknown endpoints answer 404 and are logged.
 *
 * Test helpers:
 *   GET  /__fake/transactions  every mutate/actions request body received, in order
 *   GET  /__fake/doc/:id       a document as currently stored
 *   POST /__fake/reset         reload fixtures and clear the transaction log
 *
 * Usage: node dev/fake-lake/server.mjs [port]  (default 3334)
 *
 * It serves HTTP/2 over TLS with a throwaway self-signed certificate (generated with openssl on
 * first run into dev/fake-lake/.cert). HTTP/2 matters: the Studio keeps more than six listener
 * streams open, and over HTTP/1.1 the browser's six-connections-per-host limit would queue every
 * other request forever. Launch the browser with ignoreHTTPSErrors.
 */
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, readFileSync} from 'node:fs'
import {createSecureServer} from 'node:http2'

import {Mutation} from '@sanity/mutator'
import {evaluate, parse} from 'groq-js'

import {fixtures} from './fixtures.mjs'

const PORT = Number(process.argv[2] || process.env.FAKE_LAKE_PORT || 3334)
const USER = {
  id: 'p-test-user',
  name: 'Test User',
  email: 'test@example.com',
  profileImage: null,
  role: 'administrator',
  roles: [{name: 'administrator', title: 'Administrator'}],
  provider: 'sanity',
}
const GRANTS = [
  {
    filter: '_id in path("**")',
    permissions: ['read', 'create', 'update', 'history', 'editHistory'],
  },
]

const CERT_DIR = new URL('./.cert/', import.meta.url)

function getCertificate() {
  const key = new URL('key.pem', CERT_DIR)
  const cert = new URL('cert.pem', CERT_DIR)
  if (!existsSync(key) || !existsSync(cert)) {
    mkdirSync(CERT_DIR, {recursive: true})
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,DNS:*.localhost',
      '-keyout', key.pathname, '-out', cert.pathname,
    ], {stdio: 'ignore'})
  }
  return {key: readFileSync(key), cert: readFileSync(cert)}
}

/** @type {Map<string, Record<string, any>>} */
let store = new Map()
/** @type {unknown[]} */
let transactions = []
/** @type {Set<{res: import('node:http').ServerResponse, query: string, params: Record<string, unknown>, includeResult: boolean}>} */
const listeners = new Set()
let revCounter = 0

function nextRev() {
  revCounter += 1
  return `rev${String(revCounter).padStart(6, '0')}`
}

function loadFixtures() {
  const docs = structuredClone(fixtures)
  store = new Map()
  transactions = []
  for (const doc of docs) {
    store.set(doc._id, {
      _createdAt: '2026-01-01T00:00:00Z',
      _updatedAt: '2026-01-01T00:00:00Z',
      _rev: nextRev(),
      ...doc,
    })
  }
}

function cors(req, res) {
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] || 'content-type,authorization',
  )
}

function json(res, status, body) {
  res.writeHead(status, {'Content-Type': 'application/json'})
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

/** Query params like `$ids=["a"]` are JSON-encoded */
function groqParams(searchParams) {
  const params = {}
  for (const [key, value] of searchParams) {
    if (!key.startsWith('$')) continue
    try {
      params[key.slice(1)] = JSON.parse(value)
    } catch {
      params[key.slice(1)] = value
    }
  }
  return params
}

function datasetFor(perspective) {
  const docs = [...store.values()]
  const stack = Array.isArray(perspective)
    ? perspective
    : typeof perspective === 'string'
      ? perspective.split(',')
      : ['raw']

  if (stack.includes('raw')) return docs

  const published = docs.filter((doc) => !doc._id.includes('.'))
  if (stack.length === 1 && stack[0] === 'published') return published

  // drafts / previewDrafts: overlay drafts on top of published documents
  const byId = new Map(published.map((doc) => [doc._id, doc]))
  for (const doc of docs) {
    if (doc._id.startsWith('drafts.')) byId.set(doc._id.slice(7), {...doc, _id: doc._id.slice(7)})
  }
  return [...byId.values()]
}

async function runQuery(rawQuery, params, perspective) {
  // groq-js has no text::query(); a glob `match` is close enough for the Studio's list search
  const query = rawQuery.replaceAll('text::query($__query)', '$__query')
  const result = await evaluate(parse(query, {params}), {
    dataset: datasetFor(perspective),
    params,
  })
  return result.get()
}

async function matches(query, params, doc) {
  if (!doc) return false
  try {
    const result = await (await evaluate(parse(query, {params}), {dataset: [doc], params})).get()
    return Array.isArray(result) ? result.length > 0 : Boolean(result)
  } catch {
    return false
  }
}

function targetId(mutation) {
  const [op, body] = Object.entries(mutation)[0]
  if (op === 'delete' || op === 'patch') return body.id
  return body._id
}

/** Applies mutations (Content Lake format) to the store and notifies listeners */
async function commit(mutations, transactionId) {
  const byDoc = new Map()
  for (const mutation of mutations) {
    const id = targetId(mutation)
    if (!id) continue
    if (!byDoc.has(id)) byDoc.set(id, [])
    byDoc.get(id).push(mutation)
  }

  const timestamp = new Date().toISOString()
  const changes = []
  for (const [id, docMutations] of byDoc) {
    const before = store.get(id) ?? null
    let after = new Mutation({mutations: docMutations}).apply(before)
    if (after) {
      after = {
        ...after,
        _id: id,
        _rev: transactionId,
        _updatedAt: timestamp,
        _createdAt: after._createdAt ?? timestamp,
      }
      store.set(id, after)
    } else {
      store.delete(id)
    }
    changes.push({id, before, after, mutations: docMutations})
  }

  changes.forEach((change, index) => {
    const event = {
      type: 'mutation',
      eventId: `${transactionId}#${change.id}`,
      documentId: change.id,
      transactionId,
      transition: change.before ? (change.after ? 'update' : 'disappear') : 'appear',
      identity: USER.id,
      mutations: change.mutations,
      previousRev: change.before?._rev,
      resultRev: change.after?._rev ?? transactionId,
      timestamp,
      // A mendoza patch of [0, value] outputs `value` as-is: a full replacement
      effects: {apply: [0, change.after], revert: [0, change.before]},
      transactionTotalEvents: changes.length,
      transactionCurrentEvent: index + 1,
      visibility: 'transaction',
    }
    for (const listener of listeners) {
      Promise.all([
        matches(listener.query, listener.params, change.before),
        matches(listener.query, listener.params, change.after),
      ]).then(([wasMatch, isMatch]) => {
        if (!wasMatch && !isMatch) return
        const payload = listener.includeResult ? {...event, result: change.after} : event
        listener.res.write(`event: mutation\ndata: ${JSON.stringify(payload)}\n\n`)
      })
    }
  })

  return changes
}

/** Translates the Actions API into plain mutations */
function actionToMutations(action) {
  switch (action.actionType) {
    case 'sanity.action.document.edit': {
      const base = store.get(action.draftId) ?? store.get(action.publishedId)
      const mutations = []
      if (!store.has(action.draftId) && base) {
        mutations.push({createIfNotExists: {...base, _id: action.draftId}})
      }
      mutations.push({patch: {...action.patch, id: action.draftId}})
      return mutations
    }
    case 'sanity.action.document.create':
      return [{create: {...action.attributes}}]
    case 'sanity.action.document.version.create':
      return [{create: {...action.document}}]
    case 'sanity.action.document.discard':
    case 'sanity.action.document.version.discard':
      return [{delete: {id: action.draftId ?? action.versionId}}]
    case 'sanity.action.document.delete':
      return [
        {delete: {id: action.publishedId}},
        ...(action.includeDrafts ?? []).map((id) => ({delete: {id}})),
      ]
    case 'sanity.action.document.publish': {
      const draft = store.get(action.draftId)
      return draft
        ? [{createOrReplace: {...draft, _id: action.publishedId}}, {delete: {id: action.draftId}}]
        : []
    }
    default:
      console.warn(`[fake-lake] unsupported action ${action.actionType}`)
      return []
  }
}

const server = createSecureServer({...getCertificate(), allowHTTP1: true}, async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `https://${req.headers.host ?? req.headers[':authority']}`)
  // Strip the API version prefix (/v1, /v2025-02-19, /vX)
  const path = url.pathname.replace(/^\/v[^/]+/, '')
  if (process.env.FAKE_LAKE_DEBUG) console.log(`[fake-lake] ${req.method} ${url.pathname}${url.search}`)

  try {
    if (path === '/__fake/transactions') return json(res, 200, transactions)
    if (path === '/__fake/reset') {
      loadFixtures()
      return json(res, 200, {ok: true})
    }
    if (path.startsWith('/__fake/doc/')) {
      return json(res, 200, store.get(decodeURIComponent(path.slice(12))) ?? null)
    }

    // Endpoints the Studio calls that don't matter for the form: answer with empty data
    if (path === '/ping') return json(res, 200, {message: 'PONG'})
    if (path.startsWith('/journey/')) return json(res, 200, {})
    if (path === '/help') return json(res, 200, {})
    if (/^\/projects\/[^/]+\/user-applications$/.test(path)) return json(res, 200, [])
    if (/^\/projects\/[^/]+\/grants$/.test(path)) return json(res, 200, {})
    if (path.startsWith('/schedules/')) return json(res, 200, {schedules: []})

    if (path === '/users/me') return json(res, 200, USER)
    if (path.startsWith('/users/me/keyvalue')) return json(res, 200, [])
    if (path.startsWith('/users/')) return json(res, 200, [USER])
    if (/^\/projects\/[^/]+\/datasets\/[^/]+\/acl$/.test(path)) return json(res, 200, GRANTS)
    if (/^\/projects\/[^/]+\/features/.test(path) || path === '/features') return json(res, 200, [])
    if (/^\/projects\/[^/]+\/datasets$/.test(path)) return json(res, 200, [{name: 'test'}])
    if (/^\/projects\/[^/]+$/.test(path)) {
      const id = path.split('/')[2]
      return json(res, 200, {
        id,
        displayName: 'Sortable tree test',
        studioHost: null,
        organizationId: null,
        isBlocked: false,
        isDisabled: false,
        members: [{id: USER.id, role: 'administrator', isRobot: false, roles: USER.roles}],
        metadata: {},
        features: [],
      })
    }

    let match = path.match(/^\/data\/doc\/([^/]+)\/(.+)$/)
    if (match) {
      const ids = decodeURIComponent(match[2]).split(',')
      return json(res, 200, {
        documents: ids.map((id) => store.get(id)).filter(Boolean),
        omitted: ids.filter((id) => !store.has(id)).map((id) => ({id, reason: 'existence'})),
      })
    }

    match = path.match(/^\/data\/query\/([^/]+)$/)
    if (match) {
      const body = req.method === 'POST' ? await readBody(req) : null
      const query = body?.query ?? url.searchParams.get('query')
      const params = body?.params ?? groqParams(url.searchParams)
      const perspective = url.searchParams.get('perspective') ?? body?.perspective
      const result = await runQuery(query, params, perspective)
      return json(res, 200, {query, result: result ?? null, ms: 1})
    }

    match = path.match(/^\/data\/listen\/([^/]+)$/)
    if (match) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      })
      const listener = {
        res,
        query: url.searchParams.get('query') ?? '*',
        params: groqParams(url.searchParams),
        includeResult: url.searchParams.get('includeResult') === 'true',
      }
      listeners.add(listener)
      res.write(`event: welcome\ndata: ${JSON.stringify({listenerName: `l${listeners.size}`})}\n\n`)
      const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 15000)
      req.on('close', () => {
        clearInterval(keepAlive)
        listeners.delete(listener)
      })
      return undefined
    }

    match = path.match(/^\/data\/(mutate|actions)\/([^/]+)$/)
    if (match && req.method === 'POST') {
      const body = await readBody(req)
      const transactionId = body.transactionId ?? nextRev()
      transactions.push({endpoint: match[1], ...body})
      const mutations =
        match[1] === 'mutate' ? body.mutations : body.actions.flatMap(actionToMutations)
      const changes = await commit(mutations, transactionId)
      return json(res, 200, {
        transactionId,
        results: changes.map((change) => ({
          id: change.id,
          operation: change.before ? (change.after ? 'update' : 'delete') : 'create',
        })),
      })
    }

    // No history: empty events and an empty NDJSON transaction log
    if (/^\/data\/history\/[^/]+\/events\//.test(path)) {
      return json(res, 200, {events: {}, nextCursor: ''})
    }
    if (/^\/data\/history\/[^/]+\/transactions\//.test(path)) {
      res.writeHead(200, {'Content-Type': 'application/x-ndjson'})
      res.end('')
      return undefined
    }
    if (path.startsWith('/data/history/')) return json(res, 200, {documents: []})

    console.warn(`[fake-lake] 404 ${req.method} ${url.pathname}${url.search}`)
    return json(res, 404, {error: 'Not found', message: `fake-lake: ${path} is not implemented`})
  } catch (error) {
    console.error(`[fake-lake] 500 ${req.method} ${req.url}`, error)
    return json(res, 500, {error: 'Internal', message: String(error)})
  }
})

// Presence (bifur) uses a WebSocket. Accept the handshake and ignore its messages, so the Studio
// doesn't show "Trying to connect..." (presence itself isn't needed for the form).
server.on('upgrade', (req, socket) => {
  const accept = createHash('sha1')
    .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  socket.on('data', () => {})
  socket.on('error', () => {})
})

loadFixtures()
server.listen(PORT, () => console.log(`[fake-lake] listening on https://localhost:${PORT}`))
