import { relative } from 'node:path'
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import * as yauzl from 'yauzl'
import { slash } from '@antfu/utils'
import { useCommand } from 'reactive-vscode'
import { Position, Range, Selection, TextEditorRevealType, Uri, window, workspace } from 'vscode'
import { useDevServer } from './composables/useDevServer'
import { useEditingSlideSource } from './composables/useEditingSlideSource'
import { useFocusedSlideNo } from './composables/useFocusedSlideNo'
import { configuredPort, forceEnabled, include, previewSync, useApi, downloadThemeUrl } from './configs'
import { activeEntry, activeProject, activeSlidevData, addProject, projects, rescanProjects } from './projects'
import { findPossibleEntries } from './utils/findPossibleEntries'
import { usePreviewWebview } from './views/previewWebview'

export function useCommands() {
  useCommand('slidev.enable-extension', () => forceEnabled.value = true)
  useCommand('slidev.disable-extension', () => forceEnabled.value = false)

  useCommand('slidev.rescan-projects', rescanProjects)

  useCommand('slidev.choose-entry', async () => {
    const entry = await window.showQuickPick([...projects.keys()], {
      title: 'Choose active slides entry.',
    })
    if (entry)
      activeEntry.value = entry
  })

  useCommand('slidev.add-entry', async () => {
    const files = await findPossibleEntries()
    const selected = await window.showQuickPick(files, {
      title: 'Choose Markdown files to add as slides entries.',
      canPickMany: true,
    })
    if (selected) {
      for (const entry of selected)
        await addProject(entry)
      if (workspace.workspaceFolders) {
        const workspaceRoot = workspace.workspaceFolders[0].uri.fsPath
        const relatives = selected.map(s => slash(relative(workspaceRoot, s)))
        // write back to settings.json
        include.update([...include.value, ...relatives])
      }
    }
  })

  useCommand('slidev.remove-entry', async (node: any) => {
    const entry = slash(node.treeItem.resourceUri.fsPath)
    if (activeEntry.value === entry)
      activeEntry.value = null
    projects.delete(entry)
  })

  useCommand('slidev.set-as-active', async (node: any) => {
    const entry = slash(node.treeItem.resourceUri.fsPath)
    activeEntry.value = entry
  })

  useCommand('slidev.stop-dev', async (node: any) => {
    const entry = node ? slash(node.treeItem.resourceUri.fsPath) : activeEntry.value
    if (!entry)
      return
    const project = projects.get(entry)
    const { stop } = useDevServer(project!)
    stop()
  })

  async function gotoSlide(filepath: string, index: number, getNo?: () => number | null) {
    const { markdown: currrentMarkdown, index: currentIndex } = useEditingSlideSource()
    const sameFile = currrentMarkdown.value?.filepath === filepath
    if (sameFile && currentIndex.value === index)
      return

    const slide = activeSlidevData.value?.markdownFiles[filepath]?.slides[index]
    if (!slide)
      return

    const uri = Uri.file(filepath).with({
      // Add a fragment to the URI will cause a flush. So we need to remove it if it's the same file.
      fragment: sameFile ? undefined : `L${slide.contentStart + 1}`,
    })
    const editor = await window.showTextDocument(await workspace.openTextDocument(uri))

    const cursorPos = new Position(slide.contentStart, 0)
    editor.selection = new Selection(cursorPos, cursorPos)

    const startPos = new Position(slide.start, 0)
    const endPos = new Position(slide.end, 0)
    const slideRange = new Range(startPos, endPos)
    editor.revealRange(slideRange, TextEditorRevealType.AtTop)

    const no = getNo?.()
    if (no) {
      const focusedSlideNo = useFocusedSlideNo()
      focusedSlideNo.value = no
    }
  }

  useCommand('slidev.goto', gotoSlide)
  useCommand('slidev.next', () => {
    const { markdown, index } = useEditingSlideSource()
    const focusedSlideNo = useFocusedSlideNo()
    gotoSlide(markdown.value!.filepath, index.value + 1, () => focusedSlideNo.value + 1)
  })
  useCommand('slidev.prev', () => {
    const { markdown, index } = useEditingSlideSource()
    const focusedSlideNo = useFocusedSlideNo()
    gotoSlide(markdown.value!.filepath, index.value - 1, () => focusedSlideNo.value - 1)
  })

  useCommand('slidev.refresh-preview', () => {
    const { refresh } = usePreviewWebview()
    refresh()
  })

  useCommand('slidev.config-port', async () => {
    const port = await window.showInputBox({
      prompt: 'Slidev Preview Port',
      value: configuredPort.value.toString(),
      validateInput: (v) => {
        if (!v.match(/^\d+$/))
          return 'Port should be a number'
        if (+v < 1024 || +v > 65535)
          return 'Port should be between 1024 and 65535'
        return null
      },
    })
    if (!port)
      return
    configuredPort.value = +port
  })

  useCommand('slidev.toggle-api-mode', async () => {
    const currentMode = useApi.value
    const newMode = !currentMode
    useApi.value = newMode

    const modeText = newMode ? 'Direct API calls' : 'CLI commands'
    window.showInformationMessage(`Slidev server startup method changed to: ${modeText}`)
  })

  useCommand('slidev.server-status', () => {
    const project = activeProject.value
    if (!project) {
      window.showInformationMessage('No active Slidev project')
      return
    }

    const server = useDevServer(project)
    const serverInstance = server.serverInstance.value
    const port = server.port.value

    if (!port) {
      window.showInformationMessage('Slidev server is not running')
      return
    }

    let statusMessage = `Slidev server running on port ${port}`

    if (serverInstance) {
      const uptime = Math.round((Date.now() - serverInstance.startTime.getTime()) / 1000)
      statusMessage += `\nMethod: Direct API\nEntry: ${serverInstance.entry}\nUptime: ${uptime}s`
    }
    else {
      statusMessage += '\nMethod: CLI'
    }

    window.showInformationMessage(statusMessage)
  })

  useCommand('slidev.download-clpe-theme', async () => {
    try {
      const workspaceFolder = workspace.workspaceFolders?.[0]
      if (!workspaceFolder) {
        window.showErrorMessage('No workspace folder found')
        return
      }

      const themeUrl = downloadThemeUrl.value
      if (!themeUrl) {
        window.showErrorMessage('No download URL configured')
        return
      }

      const workspacePath = workspaceFolder.uri.fsPath
      const themeDir = `${workspacePath}/clpe-theme`

      // Show progress
      await window.withProgress({
        location: { viewId: 'slidev-preview' },
        title: 'Downloading CLPE theme...',
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 0, message: 'Downloading theme...' })

        // Download the zip file
        const response = await fetch(themeUrl)
        if (!response.ok) {
          throw new Error(`Failed to download theme: ${response.statusText}`)
        }

        progress.report({ increment: 50, message: 'Extracting theme...' })

        // Create theme directory if it doesn't exist
        if (!existsSync(themeDir)) {
          mkdirSync(themeDir, { recursive: true })
        }

        // Get the zip file as buffer
        const buffer = await response.arrayBuffer()
        const uint8Array = new Uint8Array(buffer)

        // Write to temporary file and extract using yauzl
        const tempZipPath = `${themeDir}/temp.zip`
        const fs = require('node:fs')
        fs.writeFileSync(tempZipPath, uint8Array)

        // Extract using yauzl
        await new Promise<void>((resolve, reject) => {
          yauzl.open(tempZipPath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
              reject(err)
              return
            }

            zipfile!.readEntry()
            zipfile!.on('entry', (entry) => {
              if (/\/$/.test(entry.fileName)) {
                // Directory entry
                const dirPath = `${themeDir}/${entry.fileName}`
                if (!existsSync(dirPath)) {
                  mkdirSync(dirPath, { recursive: true })
                }
                zipfile!.readEntry()
              } else {
                // File entry
                zipfile!.openReadStream(entry, (err, readStream) => {
                  if (err) {
                    reject(err)
                    return
                  }

                  const filePath = `${themeDir}/${entry.fileName}`
                  const dirPath = filePath.substring(0, filePath.lastIndexOf('/'))
                  if (!existsSync(dirPath)) {
                    mkdirSync(dirPath, { recursive: true })
                  }

                  const writeStream = createWriteStream(filePath)
                  readStream!.pipe(writeStream)
                  writeStream.on('close', () => {
                    zipfile!.readEntry()
                  })
                  writeStream.on('error', reject)
                })
              }
            })

            zipfile!.on('end', () => {
              // Clean up temp file
              fs.unlinkSync(tempZipPath)
              resolve()
            })

            zipfile!.on('error', reject)
          })
        })

        progress.report({ increment: 100, message: 'Theme downloaded successfully!' })
      })

      window.showInformationMessage(`CLPE theme downloaded and extracted to: ${themeDir}`)
    } catch (error) {
      window.showErrorMessage(`Failed to download CLPE theme: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  useCommand('slidev.start-dev', async () => {
    const project = activeProject.value
    if (!project) {
      window.showErrorMessage('Cannot start dev server: No active slides project.')
      return
    }

    const { start, showTerminal, serverInstance } = useDevServer(project)
    await start()

    // Only show terminal if not using API mode (i.e., using CLI mode)
    if (!serverInstance.value) {
      showTerminal()
    }

    const { retry } = usePreviewWebview()
    setTimeout(retry, 3000)
    setTimeout(retry, 5000)
    setTimeout(retry, 7000)
    setTimeout(retry, 9000)
  })

  useCommand('slidev.open-in-browser', () => usePreviewWebview().openExternal())

  useCommand('slidev.preview-prev-click', () => usePreviewWebview().prevClick())
  useCommand('slidev.preview-next-click', () => usePreviewWebview().nextClick())
  useCommand('slidev.preview-prev-slide', () => usePreviewWebview().prevSlide())
  useCommand('slidev.preview-next-slide', () => usePreviewWebview().nextSlide())

  useCommand('slidev.enable-preview-sync', () => (previewSync.value = true))
  useCommand('slidev.disable-preview-sync', () => (previewSync.value = false))
}
