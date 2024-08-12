import { createRequire } from 'node:module'
import { dirname, resolve as pathResolve } from 'node:path'
import { packageJson } from './schema.js'
import { createPortManager, getServerUrl } from './utils.js'

export class ViteStackable {
  #options
  #configManager
  #id
  #root
  #logger
  #module
  #app
  #server
  #url
  #isFastify

  constructor (options, root) {
    this.#options = options
    this.#configManager = options.configManager
    this.#id = options.id
    this.#root = root
    this.#logger = options.server.logger
  }

  async init () {
    globalThis[Symbol.for('plt.runtime.itc')].handle('getMeta', this.getMeta.bind(this))
  }

  async start () {
    // Make this idempotent
    if (this.#url) {
      return this.#url
    }

    const require = createRequire(this.#root)
    const viteRoot = require.resolve('vite')

    const { hostname, port, https, cors } = this.#options?.server ?? {}
    const serverOptions = {
      host: hostname || '127.0.0.1',
      port: port || 0,
      strictPort: false,
      https,
      cors,
      origin: 'http://localhost',
      hmr: true,
    }

    const portManager = !this.#options?.server.port ? createPortManager() : null

    let basePath = this.#options.service?.base ?? '/'

    if (!basePath.startsWith('/')) {
      basePath = `/${basePath}`
    }

    if (!basePath.endsWith('/')) {
      basePath = `/${basePath}`
    }

    const configFile = this.#options.vite?.configFile
      ? pathResolve(this.#root, this.#options.vite?.configFile)
      : undefined

    const { createServer } = await import(pathResolve(dirname(viteRoot), 'dist/node/index.js'))
    this.#app = await createServer({
      root: this.#root,
      base: this.#options.service?.base,
      mode: 'development',
      configFile,
      logLevel: this.#options.server?.logger?.level ?? 'info',
      clearScreen: false,
      optimizeDeps: { force: false },
      server: serverOptions,
    })

    await this.#app.listen()
    this.#server = this.#app.httpServer
    this.#url = getServerUrl(this.#server)

    portManager?.destroy()
  }

  async stop () {
    return this.#app.close()
  }

  getUrl () {
    return this.#url
  }

  async getConfig () {
    return this.configManager.current
  }

  async getInfo () {
    return { type: 'vite', version: packageJson.version }
  }

  getDispatchFunc () {
    return this
  }

  getMeta () {
    return {
      composer: {
        tcp: true,
        url: this.#url,
        prefix: this.#app.config.base.replace(/(^\/)|(\/$)/g, ''),
        wantsAbsoluteUrls: true,
      },
    }
  }

  async getMetrics () {
    return null
  }

  async log ({ message, level }) {
    const logLevel = level ?? 'info'
    this.#logger[logLevel](message)
  }
}
