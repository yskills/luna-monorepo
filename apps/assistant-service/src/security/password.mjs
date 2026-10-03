import crypto from 'node:crypto'

// scrypt-Parameter nach OWASP-Empfehlung (N=2^17, r=8, p=1).
const SCRYPT_N = 2 ** 17
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
const SALT_LENGTH = 16
const MAX_MEM = 256 * 1024 * 1024

const scryptAsync = (password, salt, keyLength, options) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, keyLength, options, (error, derivedKey) => {
    if (error) return reject(error)
    return resolve(derivedKey)
  })
})

// Format: scrypt:N:r:p:<salt base64url>:<hash base64url>
// Bewusst ohne "$", damit Shells und docker compose den Wert nicht als Variable interpretieren.
export async function hashPassword(password) {
  const value = String(password || '')
  if (value.length < 12) {
    throw new Error('Password must be at least 12 characters long.')
  }
  const salt = crypto.randomBytes(SALT_LENGTH)
  const hash = await scryptAsync(value, salt, KEY_LENGTH, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEM,
  })
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64url'), hash.toString('base64url')].join(':')
}

export function parsePasswordHash(encoded) {
  const parts = String(encoded || '').trim().split(':')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const [, n, r, p, saltB64, hashB64] = parts
  const params = { N: Number(n), r: Number(r), p: Number(p) }
  if (![params.N, params.r, params.p].every((v) => Number.isInteger(v) && v > 0)) return null
  if (params.N > 2 ** 20 || params.r > 32 || params.p > 16) return null
  const salt = Buffer.from(saltB64, 'base64url')
  const hash = Buffer.from(hashB64, 'base64url')
  if (salt.length < 8 || hash.length < 32) return null
  return { params, salt, hash }
}

export async function verifyPassword(password, encoded) {
  const parsed = parsePasswordHash(encoded)
  if (!parsed) return false
  const candidate = await scryptAsync(String(password || ''), parsed.salt, parsed.hash.length, {
    ...parsed.params, maxmem: MAX_MEM,
  })
  return crypto.timingSafeEqual(candidate, parsed.hash)
}
