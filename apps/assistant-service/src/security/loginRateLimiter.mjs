// Brute-Force-Schutz für den Login:
// - pro IP: nach `maxPerIp` Fehlversuchen im Fenster gesperrt
// - global: nach `maxGlobal` Fehlversuchen im Fenster sind alle Logins gesperrt
//   (schützt auch gegen verteilte Angriffe über viele IPs)
export function createLoginRateLimiter({
  windowMs = 15 * 60 * 1000,
  maxPerIp = 5,
  maxGlobal = 20,
  now = () => Date.now(),
} = {}) {
  const perIp = new Map()
  let global = { count: 0, startedAt: now() }

  const freshWindow = (state) => !state || (now() - state.startedAt) > windowMs

  const cleanup = () => {
    for (const [ip, state] of perIp.entries()) {
      if (freshWindow(state)) perIp.delete(ip)
    }
    if (freshWindow(global)) global = { count: 0, startedAt: now() }
  }

  const retryAfterSec = (state) => Math.max(1, Math.ceil((state.startedAt + windowMs - now()) / 1000))

  return {
    check(ip) {
      cleanup()
      if (global.count >= maxGlobal) return { allowed: false, retryAfterSec: retryAfterSec(global) }
      const state = perIp.get(ip)
      if (state && state.count >= maxPerIp) return { allowed: false, retryAfterSec: retryAfterSec(state) }
      return { allowed: true, retryAfterSec: 0 }
    },
    registerFailure(ip) {
      cleanup()
      const state = perIp.get(ip)
      if (freshWindow(state)) {
        perIp.set(ip, { count: 1, startedAt: now() })
      } else {
        state.count += 1
      }
      global.count += 1
    },
    registerSuccess(ip) {
      perIp.delete(ip)
    },
  }
}
