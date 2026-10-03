import crypto from 'node:crypto'

// Encrypts connector tokens at rest (AES-256-GCM). The key comes from LUNA_TOKEN_KEY,
// or is derived from LUNA_SESSION_SECRET with a separate HKDF label.
export function createSecretBox(env = process.env) {
  const material = String(env.LUNA_TOKEN_KEY || env.LUNA_SESSION_SECRET || '').trim()
  if (material.length < 32) return null
  const key = Buffer.from(crypto.hkdfSync('sha256', material, 'luna-connectors', 'connector-token-encryption-v1', 32))

  return {
    seal(value) {
      const iv = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
      return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
    },
    open(sealed) {
      const [version, iv, tag, body] = String(sealed || '').split('.')
      if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unknown secret format.')
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
      decipher.setAuthTag(Buffer.from(tag, 'base64url'))
      const plain = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()])
      return JSON.parse(plain.toString('utf8'))
    },
  }
}

export function createSecretStore(db, box) {
  const get = db.prepare('SELECT ciphertext FROM connector_secrets WHERE provider = ?')
  const put = db.prepare(`
    INSERT INTO connector_secrets (provider, ciphertext, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`)
  const remove = db.prepare('DELETE FROM connector_secrets WHERE provider = ?')

  return {
    read(provider) {
      const row = get.get(provider)
      if (!row || !box) return null
      try {
        return box.open(row.ciphertext)
      } catch {
        // Key changed or data tampered with: treat as disconnected.
        return null
      }
    },
    write(provider, value) {
      if (!box) throw new Error('No token key configured (LUNA_TOKEN_KEY or LUNA_SESSION_SECRET).')
      put.run(provider, box.seal(value), new Date().toISOString())
    },
    delete(provider) {
      return remove.run(provider).changes > 0
    },
  }
}
