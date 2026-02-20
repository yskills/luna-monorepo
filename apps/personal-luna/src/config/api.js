export const API_BASE_URL = String(
  import.meta.env.VITE_ASSISTANT_API_BASE_URL || '/assistant',
).replace(/\/$/, '')
