# @luna/assistant-sdk

Kleine Frontend-Schnittstellen-Lib für den gehosteten Luna Assistant Service.

## Installation

```bash
npm install @luna/assistant-sdk
```

## Nutzung

```js
import { createAssistantSdkClient } from '@luna/assistant-sdk'

const client = createAssistantSdkClient({
  baseUrl: import.meta.env.VITE_ASSISTANT_API_BASE_URL,
  apiKey: import.meta.env.VITE_ASSISTANT_API_KEY,
})

const mode = await client.getMode('luna')
```
