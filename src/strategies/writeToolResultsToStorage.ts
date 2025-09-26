import type { ModelMessage } from "ai";
import { randomUUID } from "node:crypto";
import { registerKnownKey } from "../storage/knownKeys";
import type { StorageAdapter } from "../storage/types";

function formatStoragePathForDisplay(storageUri: string, key: string): string {
  if (!storageUri) return key;
  if (storageUri.startsWith("blob:")) {
    // blob root => blob:///<key>
    if (storageUri === "blob:" || storageUri === "blob:/") {
      return `blob:///${key}`;
    }
    // blob with prefix => blob://prefix/<key>
    if (storageUri.startsWith("blob://")) {
      const base = storageUri.replace(/\/$/, "");
      return `${base}/${key}`;
    }
    // Fallback
    return `${storageUri}:${key}`;
  }
  // Default formatting uses colon separation
  return `${storageUri}:${key}`;
}

/**
 * Determine whether a message has textual content (string or text parts).
 * Used to detect conversational boundaries for compaction.
 */
export function messageHasTextContent(message: ModelMessage | any): boolean {
  if (!message) return false;
  const content: any = (message as any).content;
  if (typeof content === "string") return true;
  if (Array.isArray(content)) {
    return content.some(
      (part: any) =>
        part && part.type === "text" && typeof part.text === "string"
    );
  }
  return false;
}

/**
 * Controls where the compaction window starts.
 *
 * - "since-last-assistant-or-user-text": Start after the most recent assistant/user text message.
 *   Use this to compact only the latest turn and keep recent context intact. (Recommended default)
 * - "entire-conversation": Start at the beginning. Use this to re-compact the full history
 *   or when earlier tool outputs also need persisting.
 */
/**
 * Controls where the compaction window starts.
 *
 * - "since-last-assistant-or-user-text": Start after the most recent assistant/user text message.
 *   Use this to compact only the latest turn and keep recent context intact. (Recommended default)
 * - "entire-conversation": Start at the beginning. Use this to re-compact the full history
 *   or when earlier tool outputs also need persisting.
 * - { type: "first-n-messages", count: number }: Keep the first N messages intact and start
 *   compaction afterwards. Useful to preserve initial system/instructions or early context.
 */
export type Boundary =
  | "since-last-assistant-or-user-text"
  | "entire-conversation"
  | { type: "first-n-messages"; count: number };

/**
 * Determine the starting index of the compaction window based on the chosen boundary.
 */
/**
 * Determine the starting index of the compaction window based on the chosen boundary.
 */
export function detectWindowStart(
  messages: ModelMessage[] | any[],
  boundary: Boundary
): number {
  // Start compaction after the first N messages (keep the first N intact)
  if (
    typeof boundary === "object" &&
    boundary !== null &&
    (boundary as any).type === "first-n-messages"
  ) {
    const countRaw = (boundary as any).count;
    const n = Number.isFinite(countRaw)
      ? Math.max(0, Math.floor(countRaw as number))
      : 0;
    const len = Array.isArray(messages) ? messages.length : 0;
    // We never compact the final assistant message (loop iterates to length - 1),
    // so clamp the start within [0, len - 1]
    const upperBound = Math.max(0, len - 1);
    return Math.min(n, upperBound);
  }
  if (boundary === "entire-conversation") return 0;
  const msgs: any[] = Array.isArray(messages) ? messages : [];
  let windowStart = 0;
  for (let i = msgs.length - 2; i >= 0; i--) {
    const m = msgs[i];
    const isBoundary =
      m &&
      (m.role === "assistant" || m.role === "user") &&
      messageHasTextContent(m);
    if (isBoundary) {
      windowStart = i + 1;
      break;
    }
  }
  return windowStart;
}

/**
 * Determine the [start, end) window for compaction based on the chosen boundary.
 * The end index is exclusive. The final assistant message (last item) is never compacted.
 */
export function detectWindowRange(
  messages: ModelMessage[] | any[],
  boundary: Boundary
): { start: number; endExclusive: number } {
  const len = Array.isArray(messages) ? messages.length : 0;
  const lastIndex = Math.max(0, len - 1);
  if (len <= 1) return { start: 0, endExclusive: 0 };

  // Preserve the latest N messages; compact the older ones.
  if (
    typeof boundary === "object" &&
    boundary !== null &&
    (boundary as any).type === "first-n-messages"
  ) {
    const countRaw = (boundary as any).count;
    const n = Number.isFinite(countRaw)
      ? Math.max(0, Math.floor(countRaw as number))
      : 0;
    // End exclusive should stop before the latest N messages (and before the final assistant message)
    const endExclusive = Math.max(0, Math.min(len - 1, len - n - 1));
    return { start: 0, endExclusive };
  }

  if (boundary === "entire-conversation") {
    return { start: 0, endExclusive: Math.max(0, len - 1) };
  }

  const start = detectWindowStart(messages, boundary);
  return { start, endExclusive: Math.max(0, len - 1) };
}

/**
 * Options for the write-tool-results-to-storage compaction strategy.
 */
export interface WriteToolResultsToStorageOptions {
  /** Where to start compacting from in the message list. */
  boundary: Boundary;
  /** Storage adapter used to resolve keys and write content. */
  adapter: StorageAdapter;
  /** Converts tool outputs into strings before writing. Defaults to JSON.stringify. */
  serializeResult: (value: unknown) => string;
  /**
   * Names of tools that READ from previously written storage (e.g., read/search tools).
   * Their results will NOT be re-written; instead a friendly reference to the source is shown.
   * Provide custom names for your own reader/search tools.
   */
  storageReaderToolNames?: string[];
}

function isToolMessage(msg: any): boolean {
  return msg && msg.role === "tool" && Array.isArray(msg.content);
}

/**
 * Compaction strategy that writes tool-result payloads to storage and replaces their in-line
 * content with a concise reference to the persisted location.
 */
export async function writeToolResultsToStorageStrategy(
  messages: ModelMessage[],
  options: WriteToolResultsToStorageOptions
): Promise<ModelMessage[]> {
  const msgs = Array.isArray(messages) ? [...messages] : [];

  const lastMessage = msgs[msgs.length - 1] as any;
  const endsWithAssistantText =
    lastMessage &&
    lastMessage.role === "assistant" &&
    messageHasTextContent(lastMessage);
  if (!endsWithAssistantText) return msgs;

  const { start: windowStart, endExclusive } = detectWindowRange(
    msgs,
    options.boundary
  );

  for (let i = windowStart; i < Math.min(endExclusive, msgs.length - 1); i++) {
    const msg: any = msgs[i];
    if (!isToolMessage(msg)) continue;

    for (const part of msg.content) {
      if (!part || part.type !== "tool-result" || !part.output) continue;

      // Reference-only behavior for tools that read from storage
      const defaultStorageReaderNames = ["readFile", "grepAndSearchFile"];
      const configuredNames =
        options.storageReaderToolNames &&
        options.storageReaderToolNames.length > 0
          ? options.storageReaderToolNames
          : defaultStorageReaderNames;
      const storageReaderSet = new Set(configuredNames);
      if (part.toolName && storageReaderSet.has(part.toolName)) {
        const output: any = part.output;
        let fileName: string | undefined;
        let key: string | undefined;
        let storage: string | undefined;
        if (output && output.type === "json") {
          if (output.value && typeof output.value.fileName === "string") {
            fileName = output.value.fileName;
          }
          if (output.value && typeof output.value.key === "string") {
            key = output.value.key;
          }
          if (output.value && typeof output.value.storage === "string") {
            storage = output.value.storage;
          }
        } else if (output && typeof output.fileName === "string") {
          fileName = output.fileName;
        } else if (output) {
          // Fallback: some runtimes may deliver plain objects instead of { type: 'json', value }
          if (typeof output.key === "string") {
            key = output.key;
          }
          if (typeof output.storage === "string") {
            storage = output.storage;
          }
        }
        const display =
          storage && key
            ? `Read from storage: ${formatStoragePathForDisplay(
                storage,
                key
              )}. Key: ${key}`
            : `Read from file: ${fileName ?? "<unknown>"}`;
        part.output = {
          type: "text",
          value: display,
        };
        if (storage && key) {
          registerKnownKey(storage, key);
        }
        continue;
      }

      const output: any = part.output;
      let contentToPersist: string | undefined;

      if (output && output.type === "json" && output.value !== undefined) {
        contentToPersist =
          typeof output.value === "string"
            ? output.value
            : options.serializeResult(output.value);
      } else if (
        output &&
        output.type === "text" &&
        typeof output.text === "string"
      ) {
        contentToPersist = output.text;
      }

      if (!contentToPersist) continue;

      const fileName = `${randomUUID()}.txt`;
      const key = options.adapter.resolveKey(fileName);
      await options.adapter.write({
        key,
        body: contentToPersist,
        contentType: "text/plain",
      });

      const adapterUri = options.adapter.toString();
      const isFile = adapterUri.startsWith("file:");
      const writtenPrefix = isFile ? "Written to file" : "Written to storage";
      part.output = {
        type: "text",
        value: `${writtenPrefix}: ${formatStoragePathForDisplay(
          adapterUri,
          key
        )}. Key: ${key}. Use the read/search tools to inspect its contents.`,
      };
      registerKnownKey(adapterUri, key);
    }
  }

  return msgs;
}
