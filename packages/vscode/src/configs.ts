import type { ConfigType } from 'reactive-vscode'
import { defineConfigs, ref } from 'reactive-vscode'

export const {
  'force-enabled': forceEnabled,
  'port': configuredPortInitial,
  'annotations': displayAnnotations,
  'preview-sync': previewSyncInitial,
  include,
  exclude,
  'dev-command': devCommand,
  'use-api': useApiInitial,
} = defineConfigs('slidev', {
  'force-enabled': Boolean,
  'port': Number,
  'annotations': Boolean,
  'preview-sync': Boolean,
  'include': Object as ConfigType<string[]>,
  'exclude': String,
  'dev-command': String,
  'use-api': Boolean,
})

export const configuredPort = ref(configuredPortInitial)
export const previewSync = ref(previewSyncInitial)
export const useApi = ref(useApiInitial)
