import dotenv from 'dotenv'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { CompanionLLMService, createAssistantRouter } from '@luna/assistant-core/v1'
import { createApp } from './app.mjs'
import { startBriefingSchedule } from './cockpit/scheduler.mjs'

dotenv.config()

const port = Number(process.env.PORT || 5050)
const host = String(process.env.HOST || '127.0.0.1').trim()

if (!process.env.ASSISTANT_MODE_CONFIG_FILE) {
  const modeConfigCandidates = [
    path.resolve(process.cwd(), 'config', 'assistant-mode-config.local.json'),
    path.resolve(process.cwd(), 'config', 'assistant-mode-config.example.json'),
    path.resolve(process.cwd(), '..', '..', 'packages', 'assistant-core', 'config', 'assistant-mode-config.example.json'),
  ]

  const selectedModeConfigFile = modeConfigCandidates.find((candidate) => existsSync(candidate))
  if (selectedModeConfigFile) {
    process.env.ASSISTANT_MODE_CONFIG_FILE = selectedModeConfigFile
  } else {
    process.stdout.write('[assistant-service] Warnung: Keine Mode-Config-Datei gefunden (local/example).\n')
  }
}

if (!process.env.ASSISTANT_MEMORY_FILE) {
  process.env.ASSISTANT_MEMORY_FILE = './data/assistant-memory.sqlite'
}

let app
try {
  let cockpit
  ;({ app, cockpit } = await createApp({
    assistantRouter: createAssistantRouter({ CompanionLLMService }),
  }))
  startBriefingSchedule({ briefing: cockpit.briefing, log: (line) => process.stdout.write(`${line}\n`) })
} catch (error) {
  process.stderr.write(`[assistant-service] Start abgebrochen: ${error.message}\n`)
  process.exit(1)
}

app.listen(port, host, () => {
  const localHost = host === '0.0.0.0' ? '127.0.0.1' : host
  process.stdout.write(`Luna Assistant Service läuft auf http://${host}:${port}\n`)
  process.stdout.write(`Lokal erreichbar unter: http://${localHost}:${port}\n`)
})
