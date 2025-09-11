# JAF Math Tool Demo

This example shows how to use the built-in `mathTool` from `@xynehq/jaf/tools`:

- Directly call the tool executor without any LLM involvement
- Use the tool inside a minimal agent run powered by a mock model provider (no API keys required)

## Prerequisites

From repo root:

```
pnpm -w install
pnpm -w build  # ensure @xynehq/jaf exports are up-to-date
```

## Run the examples

- Direct tool calls:

```
pnpm --filter jaf-math-tool-demo run direct
```

- Engine-integrated run (mock provider):

```
pnpm --filter jaf-math-tool-demo run engine
```
