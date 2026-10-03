import cron from 'node-cron'

// Runs the daily briefing at LUNA_BRIEFING_TIME (HH:MM) in LUNA_TIMEZONE.
export function parseBriefingTime(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim())
  if (!match) return null
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

export function startBriefingSchedule({ briefing, env = process.env, log = () => {}, scheduler = cron }) {
  const raw = String(env.LUNA_BRIEFING_TIME ?? '07:00').trim()
  if (!raw || raw === 'off') {
    log('[briefing] Daily briefing disabled.')
    return { stop() {} }
  }
  const time = parseBriefingTime(raw)
  if (!time) throw new Error(`LUNA_BRIEFING_TIME must be HH:MM or "off", got "${raw}".`)
  const timezone = String(env.LUNA_TIMEZONE || 'Europe/Berlin')

  const task = scheduler.schedule(`${time.minute} ${time.hour} * * *`, () => {
    briefing.run('scheduled').catch((error) => log(`[briefing] Scheduled run failed: ${error.message}`))
  }, { timezone, name: 'daily-briefing' })
  log(`[briefing] Daily briefing at ${raw} (${timezone}).`)
  return { stop: () => task.stop() }
}

// Hourly connector sync (at minute 5) so metric trends have data points.
export function startConnectorSync({ sync, env = process.env, log = () => {}, scheduler = cron }) {
  if (String(env.LUNA_CONNECTOR_SYNC || 'on').trim() === 'off') return { stop() {} }
  const task = scheduler.schedule('5 * * * *', () => {
    sync().catch((error) => log(`[sync] Failed: ${error.message}`))
  }, { timezone: String(env.LUNA_TIMEZONE || 'Europe/Berlin'), name: 'connector-sync' })
  return { stop: () => task.stop() }
}
