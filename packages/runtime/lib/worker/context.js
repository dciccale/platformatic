class Context {
  #openAPISchema
  #graphQLSchema

  constructor () {
    this.#openAPISchema = null
    this.#graphQLSchema = null
  }

  get openAPISchema () {
    return this.#openAPISchema
  }

  set openAPISchema (schema) {
    this.#openAPISchema = schema
  }

  get graphQLSchema () {
    return this.#graphQLSchema
  }

  set graphQLSchema (schema) {
    this.#graphQLSchema = schema
  }
}

module.exports = { Context }
