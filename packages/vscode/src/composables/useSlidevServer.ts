import type { SlidevProject } from '../projects'
import { logger } from '../views/logger'

// Import Slidev core functions
let createServer: any
let resolveOptions: any

// Lazy load Slidev modules to avoid import issues
async function loadSlidevModules() {
  if (!createServer || !resolveOptions) {
    try {
      const { createServer: _createServer, resolveOptions: _resolveOptions } = await import('@slidev/cli')
      createServer = _createServer
      resolveOptions = _resolveOptions
    }
    catch (error) {
      logger.error('Failed to load Slidev modules:', error)
      throw new Error('Failed to load Slidev modules. Make sure @slidev/cli is properly installed.')
    }
  }
}

export interface SlidevServerInstance {
  server: any // Use any to avoid complex Vite type issues
  port: number
  entry: string
  startTime: Date
  stop: () => Promise<void>
}

/**
 * Create and start a Slidev development server directly using API calls
 * instead of CLI commands
 */
export async function createSlidevServer(
  project: SlidevProject,
  port: number,
): Promise<SlidevServerInstance> {
  await loadSlidevModules()

  try {
    // Resolve Slidev options (always use localhost for API mode)
    const options = await resolveOptions(
      {
        entry: project.entry,
        // No remote option - always use localhost for direct API calls
      },
      'dev',
    )

    // Create Vite server with Slidev configuration (always localhost)
    const server = await createServer(
      options,
      {
        server: {
          port,
          strictPort: true,
          host: 'localhost', // Always use localhost for API mode
        },
        logLevel: 'warn',
      },
    )

    // Start the server
    await server.listen(port)

    return {
      server,
      port,
      entry: project.entry,
      startTime: new Date(),
      stop: async () => {
        await server.close()
      },
    }
  }
  catch (error) {
    logger.error('Failed to create Slidev server:', error)
    throw error
  }
}

/**
 * Check if Slidev modules are available
 */
export async function checkSlidevAvailability(): Promise<boolean> {
  try {
    await loadSlidevModules()
    return true
  }
  catch {
    return false
  }
}
