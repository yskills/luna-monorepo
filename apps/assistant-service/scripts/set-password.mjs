// Setzt das Admin-Passwort: fragt es verdeckt ab und speichert nur den scrypt-Hash
// in apps/assistant-service/.env (git-ignored). Erzeugt bei Bedarf LUNA_SESSION_SECRET.
//
//   npm run set-password
//   LUNA_NEW_PASSWORD=... npm run set-password   (nicht-interaktiv)
//   node scripts/set-password.mjs --print        (nur ausgeben, z.B. im Docker-Container)
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { hashPassword } from '../src/security/password.mjs'

const serviceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envFile = process.env.LUNA_ENV_FILE
  ? path.resolve(process.env.LUNA_ENV_FILE)
  : path.join(serviceDir, '.env')
const exampleFile = path.join(serviceDir, '.env.example')

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (text) => {
      if (text.includes(question)) rl.output.write(text)
    }
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

function upsertEnvValue(content, key, value) {
  const line = `${key}=${value}`
  const pattern = new RegExp(`^#?\\s*${key}=.*$`, 'm')
  return pattern.test(content) ? content.replace(pattern, line) : `${content.replace(/\s*$/, '')}\n${line}\n`
}

async function main() {
  let password = process.env.LUNA_NEW_PASSWORD || ''
  if (!password) {
    if (!process.stdin.isTTY) {
      throw new Error('No TTY. Set LUNA_NEW_PASSWORD for non-interactive use.')
    }
    password = await askHidden('Neues Admin-Passwort (min. 12 Zeichen): ')
    const repeat = await askHidden('Passwort wiederholen: ')
    if (password !== repeat) throw new Error('Passwörter stimmen nicht überein.')
  }

  const hash = await hashPassword(password)
  const sessionSecret = crypto.randomBytes(48).toString('base64url')

  if (process.argv.includes('--print')) {
    process.stdout.write(`\nIn deine .env eintragen:\n\nLUNA_ADMIN_PASSWORD_HASH=${hash}\nLUNA_SESSION_SECRET=${sessionSecret}\n\n`)
    return
  }

  let content = ''
  if (fs.existsSync(envFile)) {
    content = fs.readFileSync(envFile, 'utf8')
  } else if (fs.existsSync(exampleFile)) {
    content = fs.readFileSync(exampleFile, 'utf8')
  }

  content = upsertEnvValue(content, 'LUNA_ADMIN_PASSWORD_HASH', hash)
  content = content.replace(/^LUNA_ADMIN_PASSWORD=.*\n?/m, '')
  // Neues Secret bei jedem Passwortwechsel: alle bestehenden Logins werden ungültig.
  content = upsertEnvValue(content, 'LUNA_SESSION_SECRET', sessionSecret)

  fs.writeFileSync(envFile, content, { mode: 0o600 })
  try {
    fs.chmodSync(envFile, 0o600)
  } catch {
    // z. B. Windows oder fremder Besitzer: Inhalt ist trotzdem geschrieben.
  }
  process.stdout.write(`Gespeichert in ${envFile} (nur der Hash, nicht das Passwort). Service neu starten.\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
