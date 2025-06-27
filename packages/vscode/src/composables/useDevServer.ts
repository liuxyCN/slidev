import type { Ref } from 'reactive-vscode'
import type { Terminal } from 'vscode'
import type { SlidevProject } from '../projects'
import type { SlidevServerInstance } from './useSlidevServer'
import { basename } from 'node:path'
import { getPort as getPortPlease } from 'get-port-please'
import { ref, toRef } from 'reactive-vscode'
import { env, window } from 'vscode'
import { devCommand, useApi } from '../configs'
import { logger } from '../views/logger'
import { useServerTerminal } from '../views/serverTerminal'
import { useServerDetector } from './useServerDetector'
import { checkSlidevAvailability, createSlidevServer } from './useSlidevServer'

export type Server = {
  port: Ref<number | null>
  terminal: Ref<Terminal | null>
  start: () => Promise<void>
  showTerminal: () => void
  stop: () => Promise<void>
  serverInstance: Ref<SlidevServerInstance | null>
} & ReturnType<typeof useServerDetector>

const serverMap = new Map<SlidevProject, Server>()

export function useDevServer(project: SlidevProject) {
  const existing = serverMap.get(project)
  if (existing)
    return existing

  const { terminal, getIsActive, show: showTerminal, sendText, close } = useServerTerminal(project)
  const port = toRef(project, 'port')
  const serverInstance = ref<SlidevServerInstance | null>(null)

  async function start() {
    if (getIsActive() || serverInstance.value)
      return

    try {
      port.value ??= await getPort()

      // Check user preference and API availability
      const shouldUseApi = useApi.value
      const isApiAvailable = shouldUseApi ? await checkSlidevAvailability() : false

      if (shouldUseApi && isApiAvailable) {
        // Use direct API call
        logger.info('Starting Slidev server using direct API...')
        serverInstance.value = await createSlidevServer(project, port.value)
        logger.info(`Slidev server started successfully on port ${port.value}`)
      }
      else {
        // Use CLI method (either by preference or fallback)
        if (shouldUseApi && !isApiAvailable) {
          logger.info('Slidev API not available, falling back to CLI method...')
        }
        else {
          logger.info('Using CLI method as configured...')
        }
        const args = [
          JSON.stringify(basename(project.entry)),
          `--port ${port.value}`,
          env.remoteName != null ? '--remote' : '',
        ].filter(Boolean).join(' ')
        // eslint-disable-next-line no-template-curly-in-string
        sendText(devCommand.value.replaceAll('${args}', args).replaceAll('${port}', `${port.value}`))
      }
    }
    catch (error) {
      logger.error('Failed to start Slidev server:', error)
      window.showErrorMessage(`Failed to start Slidev server: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function stop() {
    try {
      if (serverInstance.value) {
        logger.info(`Stopping Slidev server on port ${serverInstance.value.port}...`)
        await serverInstance.value.stop()
        serverInstance.value = null
        logger.info('Slidev server stopped successfully')
      }
      close()
      port.value = null
    }
    catch (error) {
      logger.error('Failed to stop Slidev server:', error)
      // Still try to clean up
      close()
      port.value = null
      serverInstance.value = null
    }
  }

  const result: Server = {
    port,
    terminal,
    start,
    showTerminal,
    stop,
    serverInstance,
    ...useServerDetector(port, project.entry),
  }
  serverMap.set(project, result)
  return result
}

async function getPort() {
  const usedPorts = [...serverMap.values()].map(server => server.port.value ?? 0)
  const minPort = Math.max(3029, ...usedPorts) + 1
  return await getPortPlease({
    portRange: [minPort, 4000],
  })
}
