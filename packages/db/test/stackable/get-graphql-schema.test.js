'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { join } = require('node:path')
const { buildConfigManager, getConnectionInfo } = require('../helper')
const { buildStackable } = require('../..')

test('get service openapi schema via stackable api', async t => {
  globalThis.platformatic = {}

  const workingDir = join(__dirname, '..', 'fixtures', 'directories')
  const { connectionInfo, dropTestDB } = await getConnectionInfo()

  const config = {
    server: {
      hostname: '127.0.0.1',
      port: 0,
    },
    db: {
      ...connectionInfo,
    },
    plugins: {
      paths: [join(workingDir, 'routes')],
    },
    watch: false,
    metrics: false,
  }

  const configManager = await buildConfigManager(config, workingDir)
  const { stackable } = await buildStackable({ configManager })

  t.after(async () => {
    await stackable.stop()
    await dropTestDB()
  })
  await stackable.start()

  assert.strictEqual(globalThis.platformatic.graphQLSchema, 'type Query {\n  hello: String\n}')
})

test('get nothing if server does not expose graphql', async t => {
  globalThis.platformatic = {}

  const workingDir = join(__dirname, '..', 'fixtures', 'directories')
  const { connectionInfo, dropTestDB } = await getConnectionInfo()

  const config = {
    server: {
      hostname: '127.0.0.1',
      port: 0,
    },
    db: {
      graphql: false,
      ...connectionInfo,
    },
    plugins: {
      paths: [join(workingDir, 'routes')],
    },
    watch: false,
    metrics: false,
  }

  const configManager = await buildConfigManager(config, workingDir)
  const { stackable } = await buildStackable({ configManager })

  t.after(async () => {
    await stackable.stop()
    await dropTestDB()
  })
  await stackable.start()

  assert.ifError(globalThis.platformatic.graphQLSchema)
})
