# @luna/assistant-sdk

Kleine Frontend-Schnittstellen-Lib für den gehosteten Luna Assistant Service.

## Installation

```bash
npm install @luna/assistant-sdk
```

## Nutzung

```js
import { createAssistantSdkClient } from '@luna/assistant-sdk'

// Browser: same-origin, Login per Session-Cookie
const client = createAssistantSdkClient({
  baseUrl: '/assistant',
  onUnauthorized: () => router.push('/login'),
})

await client.login(password)
const mode = await client.getMode('luna')
```

Server-zu-Server (z. B. geplante Jobs) kann stattdessen `apiKey` nutzen.
Niemals einen API-Key über `VITE_*` ins Frontend geben: alles mit `VITE_` landet öffentlich im Bundle.
