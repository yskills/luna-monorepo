import fs from 'fs';
import path from 'path';

// Append-only log of blocks. Stores what was blocked and where, never the content itself.
class BlockLog {
  constructor({ filePath = '', maxReadLines = 500 } = {}) {
    this.filePath = filePath;
    this.maxReadLines = maxReadLines;
    this.memory = [];
  }

  record({ stage, category, level, mode, characterId, at = new Date().toISOString() } = {}) {
    const entry = {
      at,
      stage: String(stage || ''),
      category: String(category || 'unknown'),
      level: String(level || ''),
      mode: String(mode || ''),
      characterId: String(characterId || ''),
    };
    if (!this.filePath) {
      this.memory.push(entry);
      return entry;
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }

  readRecent(limit = 50) {
    const max = Math.max(1, Math.min(this.maxReadLines, Number(limit) || 50));
    if (!this.filePath) return this.memory.slice(-max).reverse();
    if (!fs.existsSync(this.filePath)) return [];
    return fs.readFileSync(this.filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-max)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean)
      .reverse();
  }
}

export default BlockLog;
