'use strict'

const assert = require('node:assert')
const { test } = require('node:test')
const { buildStackable } = require('../..')
const { createGraphqlService } = require('../helper')

test('should start composer with a graphql service', async t => {
  globalThis.platformatic = {}

  const graphql1 = await createGraphqlService(t, {
    schema: `
    type Query {
      add(x: Int, y: Int): Int
    }`,
    resolvers: {
      Query: {
        async add (_, { x, y }) {
          return x + y
        },
      },
    },
  })

  const graphql1Host = await graphql1.listen()

  const { stackable } = await buildStackable({
    composer: {
      services: [
        {
          id: 'graphql1',
          origin: graphql1Host,
          graphql: true,
        },
      ],
    },
  })
  t.after(async () => {
    await stackable.stop()
  })
  await stackable.start()

  assert.strictEqual(globalThis.platformatic.graphQLSchema, 'type Query {\n  add(x: Int, y: Int): Int\n}')
})

test('get nothing if server does not expose openapi', async t => {
  globalThis.platformatic = {}

  const config = {
    composer: {
      services: [],
    },
  }

  const { stackable } = await buildStackable(config)
  t.after(async () => {
    await stackable.stop()
  })
  await stackable.start()

  assert.ifError(globalThis.platformatic.graphQLSchema)
})
