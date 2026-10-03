import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// Generated images live next to the memory database, never in the repo.
class ImageStore {
  constructor({ dir }) {
    if (!dir) throw new Error('ImageStore requires a dir.');
    this.dir = path.resolve(dir);
  }

  save(buffer, meta = {}) {
    const id = crypto.randomUUID();
    const mimeType = EXTENSIONS[meta.mimeType] ? meta.mimeType : 'image/png';
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, `${id}.${EXTENSIONS[mimeType]}`), buffer);
    fs.writeFileSync(path.join(this.dir, `${id}.json`), JSON.stringify({ ...meta, id, mimeType }, null, 2));
    return { id, mimeType };
  }

  get(id = '') {
    if (!ID_PATTERN.test(String(id))) return null;
    const metaPath = path.join(this.dir, `${id}.json`);
    if (!fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const filePath = path.join(this.dir, `${id}.${EXTENSIONS[meta.mimeType] || 'png'}`);
    if (!fs.existsSync(filePath)) return null;
    return { meta, filePath, mimeType: meta.mimeType };
  }
}

export default ImageStore;
