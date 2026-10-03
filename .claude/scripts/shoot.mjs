#!/usr/bin/env node
// Screenshot Luna pages (or any reference URL) at phone and desktop size.
//
//   node .claude/scripts/shoot.mjs [--base URL] [--out DIR] [--only phone|desktop] [--full] [path-or-url ...]
//
// Defaults: base http://127.0.0.1:5050, out ./.shots, paths "/".
// If the Luna login form shows up, it logs in with LUNA_SHOT_PASSWORD (env only, never a flag,
// so it never lands in shell history or a transcript). Absolute URLs are shot as-is, which is how
// design references get captured.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  // Cloud sessions ship Playwright globally; on the laptop: `npm i -g playwright && npx playwright install chromium`.
  ;({ chromium } = require('/opt/node-tools/node_modules/playwright'))
}

const VIEWPORTS = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
}

const args = process.argv.slice(2)
let base = 'http://127.0.0.1:5050'
let out = '.shots'
let only = null
let fullPage = false
const targets = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--base') base = args[++i]
  else if (a === '--out') out = args[++i]
  else if (a === '--only') only = args[++i]
  else if (a === '--full') fullPage = true
  else targets.push(a)
}
if (!targets.length) targets.push('/')
mkdirSync(out, { recursive: true })

const slug = (t) =>
  t.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'

const executablePath = process.env.PLAYWRIGHT_BROWSERS_PATH === '/opt/pw-browsers' ? '/opt/pw-browsers/chromium' : undefined
// Reference sites need the outbound proxy when one is set (cloud sessions). Chromium ignores a
// loopback bypass, so local Luna runs and reference runs are separate invocations.
const external = targets.some((t) => /^https?:\/\//.test(t) && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(t))
const proxyServer = external ? process.env.HTTPS_PROXY || process.env.https_proxy : undefined
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  ...(proxyServer ? { proxy: { server: proxyServer } }: {}),
})
const saved = []
try {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    if (only && only !== name) continue
    const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.deviceScaleFactor, isMobile: viewport.isMobile, hasTouch: viewport.hasTouch })
    const page = await context.newPage()
    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    for (const target of targets) {
      const url = /^https?:\/\//.test(target) ? target : new URL(target, base).href
      await page.goto(url, { waitUntil: 'networkidle' })
      const pw = page.locator('input[type="password"]').first()
      // The router redirects to /login only after its auth check returns, so give it a moment.
      const needsLogin = url.startsWith(base) && (await pw.waitFor({ timeout: 3000 }).then(() => true, () => false))
      if (needsLogin) {
        if (!process.env.LUNA_SHOT_PASSWORD) throw new Error('Login form shown: set LUNA_SHOT_PASSWORD in the environment.')
        await pw.fill(process.env.LUNA_SHOT_PASSWORD)
        const [res] = await Promise.all([
          page.waitForResponse((r) => r.url().endsWith('/auth/login')),
          page.locator('button[type="submit"]').click(),
        ])
        if (!res.ok()) throw new Error(`Login failed (${res.status()}). Check LUNA_SHOT_PASSWORD.`)
        await page.goto(url, { waitUntil: 'networkidle' })
      }
      await page.waitForTimeout(400)
      const file = path.join(out, `${slug(target)}-${name}.png`)
      await page.screenshot({ path: file, fullPage })
      saved.push(file)
    }
    if (errors.length) console.warn(`[${name}] console errors:\n  ${errors.join('\n  ')}`)
    await context.close()
  }
} finally {
  await browser.close()
}
console.log(saved.join('\n'))
