// Decides whether an endpoint stays on this machine or the private network.
// Used to keep adult/secret content away from hosted APIs.
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^host\.docker\.internal$/i,
  // Docker compose service names have no dots (e.g. "ollama", "comfyui").
  /^[a-z0-9_-]+$/i,
];

export function isLocalUrl(url = '') {
  try {
    const { hostname } = new URL(String(url));
    return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

export default isLocalUrl;
