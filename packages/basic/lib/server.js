import inject from 'light-my-request'
import { Server } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { packageJson } from './schema.js'
import { createPortManager, getServerUrl, injectViaRequest, isFastify } from './utils.js'

export class ServerStackable {
  #options
  #configManager
  #id
  #root
  #entrypoint
  #hadEntrypointField
  #logger
  #module
  #app
  #version
  #dispatcher
  #server
  #url
  #isFastify

  constructor (options, root, entrypoint, hadEntrypointField) {
    this.#options = options
    this.#configManager = options.configManager
    this.#id = options.id
    this.#root = root
    this.#entrypoint = entrypoint
    this.#hadEntrypointField = hadEntrypointField
    this.#logger = options.server.logger
  }

  async start ({ listen }) {
    // Make this idempotent
    if (this.#url) {
      return this.#url
    }

    if (this.#app && listen) {
      await this.#listen()
      return this.#url
    }

    if (!this.#hadEntrypointField) {
      this.#logger.warn(
        `The service ${this.#id} had no valid entrypoint defined in the package.json file. Falling back to the file ${this.#entrypoint}.`
      )
    }

    // The port manager must be created before requiring the entrypoint even if it's not going to be used
    // at all. Otherwise there is chance we miss the listen event.
    const portManager = createPortManager()
    this.#module = await import(pathToFileURL(join(this.#root, this.#entrypoint)))
    this.#module = this.#module.default || this.#module

    if (typeof this.#module.build === 'function') {
      // We have build function, this Stackable will not use HTTP unless it is the entrypoint
      portManager.destroy()

      this.#app = await this.#module.build(this.#options)
      this.#isFastify = isFastify(this.#app)

      if (this.#isFastify) {
        await this.#app.ready()
      } else if (this.#app instanceof Server) {
        this.#server = this.#app
        this.#dispatcher = this.#server.listeners('request')[0]
      }
    } else {
      // User blackbox function, we wait for them to listen on a port
      this.#server = await portManager.getServer()
      this.#url = getServerUrl(this.#server)
      portManager.destroy()
    }

    return this.#url
  }

  async stop () {
    if (this.#isFastify) {
      return this.#app.close()
    } else if (this.#server) {
      if (!this.#server.listening) {
        return
      }

      return new Promise((resolve, reject) => {
        this.#server.close(error => {
          if (error) {
            return reject(error)
          }

          resolve(error)
        })
      })
    }
  }

  getUrl () {
    return this.#url
  }

  async getConfig () {
    return this.configManager.current
  }

  async getInfo () {
    return { type: 'nodejs', version: packageJson.version }
  }

  getDispatchFunc () {
    return this
  }

  async getMetrics ({ format }) {
    return null
  }

  async inject (injectParams, onInject) {
    let res
    if (this.#isFastify) {
      res = await this.#app.inject(injectParams, onInject)
    } else if (this.#dispatcher) {
      res = await inject(this.#dispatcher, injectParams, onInject)
    } else {
      res = await injectViaRequest(this.#url, injectParams, onInject)
    }

    if (onInject) {
      return
    }

    // Since inject might be called from the main thread directly via ITC, let's clean it up
    const { statusCode, headers, body, payload, rawPayload } = res

    return { statusCode, headers, body, payload, rawPayload }
  }

  async log ({ message, level }) {
    const logLevel = level ?? 'info'
    this.#logger[logLevel](message)
  }

  async #listen () {
    const serverOptions = this.#options.server

    if (this.#isFastify) {
      await this.#app.listen({ host: serverOptions?.hostname || '127.0.0.1', port: serverOptions?.port || 0 })
      this.#url = getServerUrl(this.#app.server)
    } else {
      // Express / Node
      this.#server = await new Promise((resolve, reject) => {
        return this.#app
          .listen({ host: serverOptions?.hostname || '127.0.0.1', port: serverOptions?.port || 0 }, function () {
            resolve(this)
          })
          .on('error', reject)
      })

      this.#url = getServerUrl(this.#server)
    }
    return this.#url
  }
}
