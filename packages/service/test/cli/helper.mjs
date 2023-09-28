import { Agent, setGlobalDispatcher } from 'undici'
import { on } from 'events'
import { execa } from 'execa'
import split from 'split2'
import { join } from 'desm'
import kill from 'tree-kill'

setGlobalDispatcher(new Agent({
  keepAliveTimeout: 10,
  keepAliveMaxTimeout: 10,
  tls: {
    rejectUnauthorized: false
  }
}))

export const cliPath = join(import.meta.url, '..', '..', 'service.mjs')

export async function start (commandOpts, exacaOpts = {}) {
  const child = execa('node', [cliPath, 'start', ...commandOpts], exacaOpts)
  child.stderr.pipe(process.stdout)

  const output = child.stdout.pipe(split(function (line) {
    try {
      const obj = JSON.parse(line)
      return obj
    } catch (err) {
      console.log(line)
    }
  }))
  child.ndj = output

  const errorTimeout = setTimeout(() => {
    throw new Error('Couldn\'t start server')
  }, 30000)

  for await (const messages of on(output, 'data')) {
    for (const message of messages) {
      const text = message.msg
      if (text && text.includes('Server listening at')) {
        const url = text.match(/Server listening at (.*)/)[1]
        clearTimeout(errorTimeout)
        return { child, url, output }
      }
    }
  }
}

export async function safeKill (child) {
  kill(child.pid)
}
