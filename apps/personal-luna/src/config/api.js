// Die API muss same-origin laufen (gleiche Domain wie die App), sonst sendet der Browser
// das SameSite=Strict-Session-Cookie nicht. Lokal proxied Vite /assistant und /auth.
export const API_BASE_URL = '/assistant'
