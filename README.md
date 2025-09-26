## ctx-zip

Keep your agent context small and cheap by zipping large tool results out of the conversation and into storage. ctx-zip automatically persists bulky tool outputs (JSON/text) to a storage backend and replaces them in the message list with short, human- and model-friendly references. You control when and how compaction happens, including a simple "last-N messages" strategy for long-running loops.

Works primarily with the AI SDK for agents and loop control. See: [AI SDK – Loop Control: Context Management](https://ai-sdk.dev/docs/agents/loop-control#context-management).

### What problem it solves

- **Context bloat**: Tool calls often return large payloads (logs, search results, files). Keeping these in the message history quickly exhausts the model context window and raises costs.
- **Slower iterations**: Bigger histories mean slower prompts and higher latency.

### How it solves it

- **Persist large tool outputs** to a storage backend (local filesystem or Vercel Blob) and **replace them with concise references** (e.g., `Written to storage: blob://prefix/abc.txt`).
 - **Out-of-the-box reader tools** let the model follow references and read/search on demand (e.g., `readFile`, `grepAndSearchFile`).
- **Configurable boundaries** let you decide what to compact (entire history, since the last assistant/user text, or preserve the first N messages such as system/instructions).
- **Works with AI SDK agent loops** via `prepareStep` so you can also layer a simple, robust "last-N" message-retention strategy.

---

## Installation

```bash
npm i ctx-zip
# or
pnpm add ctx-zip
```

---

## Quickstart: generateText with prepareStep (last-N + compaction)

The example below shows how to keep only the last N messages while also compacting tool results to storage on each step. It follows the AI SDK `prepareStep` pattern for loop control.

## Out-of-the-box tools for reading storage references

After compaction, the model will see short references like `Written to storage: blob://prefix/<key>`. The agent can then retrieve or search that content using the built-in tools below. Add them to your `tools` map so the model can call them when it needs to re-open persisted outputs.

- **readFile**: Reads a full file by `key` from a `storage` URI (`file://...` or `blob:`).
- **grepAndSearchFile**: Runs a regex search over a file in storage.

Usage:

```ts
import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  compactMessages,
  // Optional: use a URI string instead of constructing an adapter
  createStorageAdapter,
  createReadFileTool,
  createGrepAndSearchFileTool,
} from "ctx-zip";

// Choose a storage backend (see Storage section below)
// - Local filesystem (default if omitted): file:///absolute/path
// - Vercel Blob: blob: (requires BLOB_READ_WRITE_TOKEN)
const storageUri = process.env.USE_BLOB ? "blob:" : `file://${process.cwd()}`;

const N = 12; // Keep only the most recent 12 messages plus the system message

const result = await generateText({
  model: openai("gpt-4.1-mini"),
  tools: {
    // Provide built-in tools so the model can read/search persisted outputs
    readFile: createReadFileTool(),
    grepAndSearchFile: createGrepAndSearchFileTool(),
    // ... your other tools (zod-typed) ...
  },
  stopWhen: stepCountIs(6),
  prompt: "Use tools to research, summarize, and cite sources.",
  prepareStep: async ({ messages }) => {
    // Compact tool results while keeping the latest N messages intact
    const compacted = await compactMessages(messages, {
      storage: storageUri, // or createStorageAdapter(storageUri)
      boundary: { type: "first-n-messages", count: N },
    });

    return { messages: compacted };
  },
});

console.log(result.text);
```

Notes:
- The compactor recognizes reader/search tools like `readFile` and `grepAndSearchFile` so their outputs aren’t re-written; a friendly "Read from storage" reference is shown instead.
- You can pass your own `storageReaderToolNames` to extend this behavior for custom reader tools. If you provide additional reader tools, include them in the `tools` map and add their names to `storageReaderToolNames` so compaction treats their outputs as references rather than rewriting to storage.

Tool inputs (model-provided):

- **readFile**: `{ key: string; storage: string }`
- **grepAndSearchFile**: `{ key: string; storage: string; pattern: string; flags?: string }`

By default, `compactMessages` treats `readFile` and `grepAndSearchFile` as reader tools and will not re-write their results back to storage; instead it replaces them with a short reference to the source so the context stays lean.

---

## Configuration Options

`compactMessages(messages, options)` accepts:

```ts
interface CompactOptions {
  strategy?: "write-tool-results-to-storage" | string; // default
  storage?: string | StorageAdapter | undefined;        // e.g. "file:///..." | "blob:" | adapter instance
  boundary?:
    | "since-last-assistant-or-user-text"
    | "entire-conversation"
    | { type: "first-n-messages"; count: number };     // keep first N intact
  serializeResult?: (value: unknown) => string;         // default: JSON.stringify(v, null, 2)
  storageReaderToolNames?: string[];                    // tool names that read from storage
}
```

- **strategy**: Currently only `write-tool-results-to-storage` is supported.
- **storage**: Destination for persisted tool outputs. Provide a URI (`file://...`, `blob:`) or an adapter.
- **boundary**:
  - `since-last-assistant-or-user-text` (default): Compact only the latest turn.
  - `entire-conversation`: Re-compact the full history.
  - `{ type: "first-n-messages", count: N }`: Preserve the first N messages (useful for system instructions) and compact the rest.
- **serializeResult**: Customize how non-string tool outputs are converted to text before writing.
- **storageReaderToolNames**: Tool names whose outputs will be replaced with a reference back to the source instead of being re-written.

---

## Storage Backends

ctx-zip supports local filesystem and Vercel Blob out of the box. Choose one via a URI in `CompactOptions.storage` or by passing a constructed adapter.

### Local filesystem (default)

- URI form: `file:///absolute/output/dir`
- If omitted, ctx-zip writes under `process.cwd()`.

Examples:

```ts
// Use a URI
await compactMessages(messages, { storage: "file:///var/tmp/ctx-zip" });

// Or construct an adapter
import { FileStorageAdapter } from "ctx-zip";
await compactMessages(messages, {
  storage: new FileStorageAdapter({ baseDir: "/var/tmp/ctx-zip" }),
});
```

### Vercel Blob

- URI form: `blob:` (optionally `blob://prefix`)
- Env: set `BLOB_READ_WRITE_TOKEN` (this single token is sufficient)

Examples:

```ts
// Use a URI (requires BLOB_READ_WRITE_TOKEN)
await compactMessages(messages, { storage: "blob:" });

// Or construct an adapter with a prefix
import { VercelBlobStorageAdapter } from "ctx-zip";
await compactMessages(messages, {
  storage: new VercelBlobStorageAdapter({ prefix: "my-agent" }),
});
```

`.env` example:

```bash
# Required for Vercel Blob
BLOB_READ_WRITE_TOKEN=vcblt_rw_...
```

---

## Implement a custom storage adapter (S3, Supabase, etc.)

Adapters implement a minimal interface so you can persist anywhere (S3, Supabase, GCS, Azure Blob, databases, …):

```ts
export interface StorageAdapter {
  write(params: { key: string; body: string | Uint8Array; contentType?: string }): Promise<{ key: string; url?: string }>;
  readText?(params: { key: string }): Promise<string>;
  openReadStream?(params: { key: string }): Promise<NodeJS.ReadableStream>;
  resolveKey(name: string): string; // map a file name to a storage key/path
  toString(): string;                // human-readable URI (e.g., "blob://prefix")
}
```

Example: S3 (sketch):

```ts
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { StorageAdapter } from "ctx-zip";

class S3StorageAdapter implements StorageAdapter {
  constructor(private bucket: string, private prefix = "") {}

  resolveKey(name: string) {
    const safe = name.replace(/\\/g, "/").replace(/\.+\//g, "");
    return this.prefix ? `${this.prefix.replace(/\/$/, "")}/${safe}` : safe;
  }

  async write({ key, body, contentType }: { key: string; body: string | Uint8Array; contentType?: string }) {
    const s3 = new S3Client({});
    const Body = typeof body === "string" ? new TextEncoder().encode(body) : body;
    await s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body, ContentType: contentType }));
    return { key, url: `s3://${this.bucket}/${key}` };
  }

  toString() {
    return `s3://${this.bucket}${this.prefix ? "/" + this.prefix : ""}`;
  }
}

// Usage
// await compactMessages(messages, { storage: new S3StorageAdapter("my-bucket", "agent-prefix") });
```

You can apply the same pattern to Supabase Storage, GCS, Azure Blob, or any other service.

---

## Tips

- Pair compaction with AI SDK loop control to dynamically trim history and adjust models/tools per step. See: [AI SDK – Loop Control: Context Management](https://ai-sdk.dev/docs/agents/loop-control#context-management).
- When preserving long-lived system instructions, consider `boundary: { type: "first-n-messages", count: N }`.
- For debugging, use the file backend first (`file://...`) to inspect outputs locally, then switch to `blob:` for production.

---

## API Surface

From `ctx-zip`:

- **Compaction**: `compactMessages(messages, options)` and `CompactOptions`
- **Strategies**: `detectWindowStart`, `messageHasTextContent` (advanced)
- **Storage Adapters**: `FileStorageAdapter`, `VercelBlobStorageAdapter`, `createStorageAdapter(uriOrAdapter)`
- **Utilities**: `resolveFileUriFromBaseDir`, `grepObject` (advanced)
- **Tools**: `createReadFileTool`, `createGrepAndSearchFileTool` (recognized as reader tools by default)



---

Built with <3 by the team behind [Langtrace](https://langtrace.ai) and [Zest](https://heyzest.ai).

