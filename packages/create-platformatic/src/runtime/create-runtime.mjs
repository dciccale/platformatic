import { readFile, writeFile, readdir, unlink } from 'fs/promises'
import { join, relative, isAbsolute } from 'path'
import * as desm from 'desm'
import { createGitRepository } from '../create-git-repository.mjs'

function generateConfig (version, path, entrypoint) {
  const config = {
    $schema: `https://platformatic.dev/schemas/v${version}/runtime`,
    entrypoint,
    allowCycles: false,
    hotReload: true,
    autoload: {
      path,
      exclude: ['docs']
    }
  }

  return config
}

async function createRuntime (params, logger, currentDir = process.cwd(), version) {
  const {
    servicesDir,
    entrypoint,
    entrypointPort,
    initGitRepository
  } = params
  if (!version) {
    const pkg = await readFile(desm.join(import.meta.url, '..', '..', 'package.json'))
    version = JSON.parse(pkg).version
  }
  const path = isAbsolute(servicesDir) ? relative(currentDir, servicesDir) : servicesDir
  const config = generateConfig(version, path, entrypoint)
  await writeFile(join(currentDir, 'platformatic.runtime.json'), JSON.stringify(config, null, 2))
  logger.info('Configuration file platformatic.runtime.json successfully created.')
  if (servicesDir && entrypoint && entrypointPort) {
    const servicesDirFullPath = isAbsolute(servicesDir)
      ? servicesDir
      : join(currentDir, servicesDir)

    await updateServerConfig(currentDir)
    await mergeEnvFiles(currentDir, servicesDirFullPath, entrypointPort)
  }

  if (initGitRepository) {
    await createGitRepository(logger, currentDir)
  }
  return {}
}
/**
 * @param {string} runtimeDir The runtime directory directory
 * @param {string} servicesDir The services directory
 * @returns {Promise} the global env object
 */
async function mergeEnvFiles (runtimeDir, servicesDir, port) {
  const dirs = await readdir(servicesDir)
  let globalEnvContents = `# This file was generated by Platformatic

PORT=${port}
PLT_SERVER_HOSTNAME=127.0.0.1
PLT_SERVER_LOGGER_LEVEL=info
`
  for (const dir of dirs) {
    const envFilePath = join(servicesDir, dir, '.env')
    const envFile = await readFile(envFilePath, 'utf8')
    globalEnvContents += `${envFile}\n`
    await unlink(envFilePath)
  }

  await writeFile(join(runtimeDir, '.env'), globalEnvContents)
  await writeFile(join(runtimeDir, '.env.sample'), stripEnvFileValues(globalEnvContents))
  return envStringToObject(globalEnvContents)
}

function stripEnvFileValues (envString) {
  const lines = envString.split('\n')
  const output = []
  for (const line of lines) {
    const match = line.match(/^(.*)=(.*)/)
    if (match) {
      const key = match[1]
      output.push(`${key}=`)
    } else {
      output.push(line)
    }
  }
  return output.join('\n')
}
function envStringToObject (envString) {
  const lines = envString.split('\n')
  const output = {}
  for (const line of lines) {
    const match = line.match(/^(.*)=(.*)/)
    if (match) {
      const key = match[1]
      const value = match[2]
      output[key] = value
    }
  }
  return output
}

async function updateServerConfig (currentDir) {
  const configPath = join(currentDir, 'platformatic.runtime.json')
  const config = JSON.parse(await readFile(configPath, 'utf8'))

  config.server = {
    hostname: '{PLT_SERVER_HOSTNAME}',
    port: '{PORT}',
    logger: {
      level: '{PLT_SERVER_LOGGER_LEVEL}'
    }
  }
  await writeFile(configPath, JSON.stringify(config, null, 2))
}

export default createRuntime
