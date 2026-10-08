// An 8 GB card cannot hold the chat model and the image model at once.
// Before ComfyUI runs, ask Ollama to unload whatever it has in VRAM.
export function createOllamaVramReleaser({ host = 'http://127.0.0.1:11434', fetchImpl = globalThis.fetch } = {}) {
  const base = String(host).replace(/\/+$/, '');
  return async function releaseOllamaVram() {
    try {
      const response = await fetchImpl(`${base}/api/ps`);
      if (!response.ok) return [];
      const data = await response.json();
      const names = (data?.models || []).map((model) => model?.name).filter(Boolean);
      await Promise.all(names.map((model) => fetchImpl(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: 0 }),
      }).catch(() => null)));
      return names;
    } catch {
      return [];
    }
  };
}

export default createOllamaVramReleaser;
