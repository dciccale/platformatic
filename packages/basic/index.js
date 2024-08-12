'use strict'

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { ConfigManager } from '@platformatic/config'

import { packageJson, schema } from './lib/schema.js'
import { ServerStackable } from './lib/server.js'

const validFields = [
  'main',
  'exports',
  'exports',
  'exports#node',
  'exports#import',
  'exports#require',
  'exports#default',
  'exports#.#node',
  'exports#.#import',
  'exports#.#require',
  'exports#.#default',
]

const validFilesBasenames = ['index', 'main', 'app', 'application', 'server', 'start', 'bundle', 'run', 'entrypoint']

async function parsePackageJson (root) {
  let entrypoint
  let packageJson
  let hadEntrypointField = false

  try {
    packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf-8'))
  } catch {
    // No package.json, we only load the index.js file
    packageJson = {}
  }

  for (const field of validFields) {
    let current = packageJson
    const sequence = field.split('#')

    while (current && sequence.length && typeof current !== 'string') {
      current = current[sequence.shift()]
    }

    if (typeof current === 'string') {
      entrypoint = current
      hadEntrypointField = true
      break
    }
  }

  if (!entrypoint) {
    for (const basename of validFilesBasenames) {
      for (const ext of ['js', 'mjs', 'cjs']) {
        const file = `${basename}.${ext}`

        if (existsSync(resolve(root, file))) {
          entrypoint = file
          break
        }
      }

      if (entrypoint) {
        break
      }
    }
  }

  return { packageJson, entrypoint, hadEntrypointField }
}

export async function buildStackable (opts) {
  const root = opts.configManager.dirname
  const { entrypoint, hadEntrypointField } = await parsePackageJson(root)

  const configType = 'nodejs'
  const Loader = ServerStackable

  const configManager = new ConfigManager({ schema, source: opts.configManager.fullPath ?? {} })
  await configManager.parseAndValidate()

  return {
    configType,
    schema,
    configManager,
    stackable: new Loader(opts, root, entrypoint, hadEntrypointField),
  }
}

export default { configType: 'nodejs', buildStackable, schema, version: packageJson.version }
