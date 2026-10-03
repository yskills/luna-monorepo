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
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // A read-only disk must never turn a block into a crash; keep it in memory instead.
      this.memory.push(entry);
    }
    return entry;
  }

  readRecent(limit = 50) {
    const max = Math.max(1, Math.min(this.maxReadLines, Number(limit) || 50));
    let fromFile = [];
    if (this.filePath && fs.existsSync(this.filePath)) {
      fromFile = fs.readFileSync(this.filePath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .slice(-max)
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
    }
    return [...fromFile, ...this.memory].slice(-max).reverse();
  }
}

export default BlockLog;
