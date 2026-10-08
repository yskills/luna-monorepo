# Luna's brain, images and content filter

Everything below runs on the laptop with the GPU (RTX 4060, 8 GB). The server
(Oracle VM, no GPU) keeps working with the local fallback or a hosted provider.

## 1. New base model (one command)

```bash
cd packages/assistant-core
npm run model:upgrade -- --dry-run   # shows the plan
npm run model:upgrade                # does it
npm run eval:compare -- --old=luna-legacy:latest --new=luna:latest
```

`model:upgrade` reads your VRAM with `nvidia-smi`, copies the current `luna:latest`
to `luna-legacy:latest`, reuses its SYSTEM prompt, pulls the new base
(`huihui_ai/qwen3.5-abliterated:9b-q4_K`, 6.6 GB, German + English, uncensored,
vision), rebuilds `luna:latest` from `config/ollama/Modelfile.luna.template` and pulls
the text guard `llama-guard3:1b`.

`eval:compare` runs the same prompts per character and mode
(`config/eval/gate.config.json`, suite `persona-consistency`) against both models. It
accepts the new model only if it passes the gate and keeps at least the old persona
pass rate. Report: `reports/eval/compare-latest.json`.

Personas and modes do not depend on the base model: the app sends the full persona
prompt from the mode config with every request.

## 2. Providers per mode / character

`llmRouting` in the mode config picks a provider. Most specific wins:
`characters.<id>.modes.<mode>` > `modes.<mode>` > `characters.<id>` > `default`
(default comes from `LLM_PROVIDER` / `LLM_MODEL`).

```json
"llmRouting": {
  "modes": { "uncensored": { "provider": "ollama", "model": "luna:latest" } },
  "characters": {
    "eva": { "provider": "anthropic", "model": "claude-haiku-4-5", "apiKeyEnv": "ANTHROPIC_API_KEY" }
  }
}
```

Providers: `ollama`, `openai-compatible` (OpenAI, OpenRouter, or local LM Studio /
KoboldCpp / llama.cpp), `anthropic`. If a provider fails, Luna falls back to the local
Ollama model (`LLM_FALLBACK_MODEL`). Keys only ever live in `.env`; the config names
the variable (`apiKeyEnv`) and refuses anything that looks like a key.

## 3. Images (ComfyUI, any model)

1. Install ComfyUI and the ComfyUI-GGUF custom node, start it on `http://127.0.0.1:8188`.
2. For the default FLUX.2 [klein] 4B workflow download:
   - `flux-2-klein-4b-Q4_K_M.gguf` (unsloth/FLUX.2-klein-4B-GGUF) → `models/unet`
   - `qwen_3_4b.safetensors` (Comfy-Org/flux2-klein-4B) → `models/text_encoders`
   - `flux2-vae.safetensors` (Comfy-Org/flux2-klein-4B) → `models/vae`
3. Put Luna's face references in `data/image-references/luna/` (git-ignored).

Each character picks its own `workflow`, `checkpoint`, `referenceImages`,
`stylePrompt` and `negativePrompt` under `characterProfiles.<id>.image`. Any checkpoint
works: for SDXL / Pony / Illustrious models use `sdxl-checkpoint.json` and put the file
in `models/checkpoints`. Your own workflows: export from ComfyUI with "Save (API
format)", add `{{prompt}}`, `{{checkpoint}}`, `{{seed}}` ... placeholders and drop
the file into `ASSISTANT_COMFY_WORKFLOW_DIR`. Before each image Luna asks Ollama to
unload its models so both fit into 8 GB.

The bundled workflows are written by hand and not yet run against a real ComfyUI.
If ComfyUI rejects a node, export the official FLUX.2 klein template in API format and
add the placeholders.

## 4. Content filter (Luna's own)

Every message, reply, image prompt and image passes four layers:

1. **Fixed floor (code, no switch):** no sexual content with minors or anyone who looks
   underage; no sexual or intimate images of real, identifiable people.
2. **Local guard on the input** (`llama-guard3:1b`, or `shieldgemma` for your own policy
   sentences).
3. **Local guard on the output**; a blocked image is never stored.
4. **Leaving the device:** posts and mails are checked at `public`, and anything created
   in `adult` can never be queued.

Levels per mode/character in `contentPolicy`: `public`, `standard` (normal mode),
`adult` (uncensored, local-only, no web search, needs a character age of 18+). You can
change each level's `block` list and add `policies`. Blocks are logged without content
(`GET /assistant/safety/blocks`).

## 5. Learning

Memory (history, summaries, notes) is the learning path. LoRA training refuses to run
below 300 curated samples (`TRAIN_MIN_CURATED` can only raise it).
`npm run train:export` prints the current count, e.g.
`Curated samples: 5/300. 295 more needed before LoRA training`.
