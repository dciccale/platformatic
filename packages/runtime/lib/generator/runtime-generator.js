'use strict'

const { BaseGenerator } = require('@platformatic/generators')
const { NoEntryPointError, NoServiceNamedError } = require('./errors')
const generateName = require('boring-name-generator')
const { join } = require('node:path')
const { envObjectToString } = require('@platformatic/generators/lib/utils')
const { readFile, readdir, stat } = require('node:fs/promises')
const { ConfigManager } = require('@platformatic/config')
const { platformaticRuntime } = require('../config')
const ServiceGenerator = require('@platformatic/service/lib/generator/service-generator')
const DBGenerator = require('@platformatic/db/lib/generator/db-generator')
const ComposerGenerator = require('@platformatic/composer/lib/generator/composer-generator')
const { CannotFindGeneratorForTemplateError, CannotRemoveServiceOnUpdateError } = require('../errors')
const { getServiceTemplateFromSchemaUrl } = require('@platformatic/generators/lib/utils')
const { DotEnvTool } = require('dotenv-tool')

class RuntimeGenerator extends BaseGenerator {
  constructor (opts) {
    super({
      ...opts,
      module: '@platformatic/runtime'
    })
    this.runtimeName = opts.name
    this.services = []
    this.entryPoint = null
  }

  async addService (service, name) {
    // ensure service config is correct
    const originalConfig = service.config
    const serviceName = name || generateName().dashed
    const newConfig = {
      ...originalConfig,
      isRuntimeContext: true,
      serviceName
    }
    // reset all files previously generated by the service
    service.reset()
    service.setConfig(newConfig)
    this.services.push({
      name: serviceName,
      service
    })

    if (typeof service.setRuntime === 'function') {
      service.setRuntime(this)
    }
  }

  setEntryPoint (entryPoint) {
    const service = this.services.find((svc) => svc.name === entryPoint)
    if (!service) {
      throw new NoServiceNamedError(entryPoint)
    }
    this.entryPoint = service
  }

  async generatePackageJson () {
    const template = {
      name: `${this.runtimeName}`,
      scripts: {
        start: 'platformatic start'
      },
      devDependencies: {
        fastify: `^${this.fastifyVersion}`,
        borp: `${this.pkgData.devDependencies.borp}`
      },
      dependencies: {
        platformatic: `^${this.platformaticVersion}`,
        ...this.config.dependencies
      },
      engines: {
        node: '^18.8.0 || >=20.6.0'
      }
    }
    if (this.config.typescript) {
      const typescriptVersion = JSON.parse(await readFile(join(__dirname, '..', '..', 'package.json'), 'utf-8')).devDependencies.typescript
      template.scripts.clean = 'rm -fr ./dist'
      template.scripts.build = 'platformatic compile'
      template.devDependencies.typescript = typescriptVersion
    }
    return template
  }

  async _beforePrepare () {
    this.setServicesDirectory()
    this.setServicesConfigValues()
    this.addServicesDependencies()

    this.addEnvVars({
      PLT_SERVER_HOSTNAME: '0.0.0.0',
      PORT: this.config.port || 3042,
      PLT_SERVER_LOGGER_LEVEL: this.config.logLevel || 'info'
    }, { overwrite: false })
  }

  addServicesDependencies () {
    this.services.forEach(({ service }) => {
      if (service.config.dependencies) {
        Object.entries(service.config.dependencies).forEach((kv) => {
          this.config.dependencies[kv[0]] = kv[1]
        })
      }
    })
  }

  async populateFromExistingConfig () {
    if (this._hasCheckedForExistingConfig) {
      return
    }
    this._hasCheckedForExistingConfig = true
    const existingConfigFile = await ConfigManager.findConfigFile(this.targetDirectory, 'runtime')
    if (existingConfigFile) {
      const configManager = new ConfigManager({
        ...platformaticRuntime.configManagerConfig,
        source: join(this.targetDirectory, existingConfigFile)
      })
      await configManager.parse()
      this.existingConfig = configManager.current
      this.config.env = configManager.env
      this.config.port = configManager.env.PORT
      this.entryPoint = configManager.current.services.find((svc) => svc.entrypoint)
    }
  }

  async prepare () {
    await this.populateFromExistingConfig()
    if (this.existingConfig) {
      this.setServicesDirectory()
      this.setServicesConfigValues()
      await this._afterPrepare()
      return {
        env: this.config.env,
        targetDirectory: this.targetDirectory
      }
    } else {
      return await super.prepare()
    }
  }

  setServicesConfigValues () {
    this.services.forEach(({ service }) => {
      if (!service.config) {
        // set default config
        service.setConfig()
      }
      service.config.typescript = this.config.typescript
    })
  }

  async _getConfigFileContents () {
    const config = {
      $schema: `https://platformatic.dev/schemas/v${this.platformaticVersion}/runtime`,
      entrypoint: this.entryPoint.name,
      allowCycles: false,
      hotReload: true,
      autoload: {
        path: 'services',
        exclude: ['docs']
      },
      server: {
        hostname: '{PLT_SERVER_HOSTNAME}',
        port: '{PORT}',
        logger: {
          level: '{PLT_SERVER_LOGGER_LEVEL}'
        }
      }
    }

    return config
  }

  async _afterPrepare () {
    if (!this.entryPoint) {
      throw new NoEntryPointError()
    }
    const servicesEnv = await this.prepareServiceFiles()
    this.addEnvVars({
      ...this.config.env,
      ...this.getRuntimeEnv(),
      ...servicesEnv
    })

    this.addFile({
      path: '',
      file: '.env',
      contents: envObjectToString(this.config.env)
    })

    this.addFile({
      path: '',
      file: '.env.sample',
      contents: envObjectToString(this.config.env)
    })

    if (!this.existingConfig) {
      this.addFile({ path: '', file: 'README.md', contents: await readFile(join(__dirname, 'README.md')) })
    }

    return {
      targetDirectory: this.targetDirectory,
      env: servicesEnv
    }
  }

  async writeFiles () {
    await super.writeFiles()
    if (!this.config.isUpdating) {
      for (const { service } of this.services) {
        await service.writeFiles()
      }
    }
  }

  async prepareQuestions () {
    await this.populateFromExistingConfig()

    // typescript
    this.questions.push({
      type: 'list',
      name: 'typescript',
      message: 'Do you want to use TypeScript?',
      default: false,
      choices: [{ name: 'yes', value: true }, { name: 'no', value: false }]
    })

    if (this.existingConfig) {
      return
    }

    // port
    this.questions.push({
      type: 'input',
      name: 'port',
      default: 3042,
      message: 'What port do you want to use?'
    })
  }

  setServicesDirectory () {
    this.services.forEach(({ service }) => {
      if (!service.config) {
        // set default config
        service.setConfig()
      }
      service.setTargetDirectory(join(this.targetDirectory, 'services', service.config.serviceName))
    })
  }

  setServicesConfig (configToOverride) {
    this.services.forEach((service) => {
      const originalConfig = service.config
      service.setConfig({
        ...originalConfig,
        ...configToOverride
      })
    })
  }

  async prepareServiceFiles () {
    let servicesEnv = {}
    for (const svc of this.services) {
      // Propagate TypeScript
      svc.service.setConfig({
        ...svc.service.config,
        typescript: this.config.typescript
      })
      const svcEnv = await svc.service.prepare()
      servicesEnv = {
        ...servicesEnv,
        ...svcEnv.env
      }
    }
    return servicesEnv
  }

  getConfigFieldsDefinitions () {
    return []
  }

  setConfigFields () {
    // do nothing, makes no sense
  }

  getRuntimeEnv () {
    return {
      PORT: this.config.port
    }
  }

  async postInstallActions () {
    for (const { service } of this.services) {
      await service.postInstallActions()
    }
  }

  getGeneratorForTemplate (templateName) {
    switch (templateName) {
      case '@platformatic/service':
        return ServiceGenerator
      case '@platformatic/db':
        return DBGenerator
      case '@platformatic/composer':
        return ComposerGenerator
      default:
        throw new CannotFindGeneratorForTemplateError(templateName)
    }
  }

  async loadFromDir () {
    const output = {
      services: []
    }
    const runtimePkgConfigFileData = JSON.parse(await readFile(join(this.targetDirectory, 'platformatic.json'), 'utf-8'))
    const servicesPath = join(this.targetDirectory, runtimePkgConfigFileData.autoload.path)

    // load all services
    const allServices = await readdir(servicesPath)
    for (const s of allServices) {
      // check is a directory
      const currentServicePath = join(servicesPath, s)
      const dirStat = await stat(currentServicePath)
      if (dirStat.isDirectory()) {
        // load the package json file
        const servicePkgJson = JSON.parse(await readFile(join(currentServicePath, 'platformatic.json'), 'utf-8'))
        // get generator for this module
        const template = getServiceTemplateFromSchemaUrl(servicePkgJson.$schema)
        const Generator = this.getGeneratorForTemplate(template)
        const instance = new Generator()
        this.addService(instance, s)
        output.services.push(await instance.loadFromDir(s, this.targetDirectory))
      }
    }
    return output
  }

  async update (newConfig) {
    let allServicesDependencies = {}
    function getDifference (a, b) {
      return a.filter(element => {
        return !b.includes(element)
      })
    }
    this.config.isUpdating = true

    // check all services are present with the same template
    const allCurrentServicesNames = this.services.map((s) => s.name)
    const allNewServicesNames = newConfig.services.map((s) => s.name)
    // load dotenv tool
    const envTool = new DotEnvTool({
      path: join(this.targetDirectory, '.env')
    })

    await envTool.load()

    const removedServices = getDifference(allCurrentServicesNames, allNewServicesNames)
    if (removedServices.length > 0) {
      throw new CannotRemoveServiceOnUpdateError(removedServices.join(', '))
    }

    // handle new services
    for (const newService of newConfig.services) {
      // create generator for the service
      const ServiceGenerator = this.getGeneratorForTemplate(newService.template)
      const serviceInstance = new ServiceGenerator()
      const baseConfig = {
        isRuntimeContext: true,
        targetDirectory: join(this.targetDirectory, 'services', newService.name),
        serviceName: newService.name
      }
      if (allCurrentServicesNames.includes(newService.name)) {
        // update existing services env values
        // otherwise, is a new service
        baseConfig.isUpdating = true
      }
      serviceInstance.setConfig(baseConfig)
      for (const plug of newService.plugins) {
        await serviceInstance.addPackage(plug)
        for (const opt of plug.options) {
          const key = `PLT_${serviceInstance.config.envPrefix}_${opt.name}`
          const value = opt.value
          if (envTool.hasKey(key)) {
            envTool.updateKey(key, value)
          } else {
            envTool.addKey(key, value)
          }
        }
      }
      allServicesDependencies = { ...allServicesDependencies, ...serviceInstance.config.dependencies }
      await serviceInstance.prepare()
      await serviceInstance.writeFiles()
    }

    // update runtime package.json dependencies
    // read current package.json file
    const currrentPackageJson = JSON.parse(await readFile(join(this.targetDirectory, 'package.json'), 'utf-8'))
    currrentPackageJson.dependencies = {
      ...currrentPackageJson.dependencies,
      ...allServicesDependencies
    }
    this.addFile({
      path: '',
      file: 'package.json',
      contents: JSON.stringify(currrentPackageJson)
    })

    await this.writeFiles()
    // save new env
    await envTool.save()
  }
}

module.exports = RuntimeGenerator
module.exports.RuntimeGenerator = RuntimeGenerator
