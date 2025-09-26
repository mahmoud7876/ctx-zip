import type { ModelMessage } from "ai";
import { createStorageAdapter } from "./storage/resolver";
import type { StorageAdapter, UriOrAdapter } from "./storage/types";
import {
  writeToolResultsToStorageStrategy,
  type Boundary,
} from "./strategies/writeToolResultsToStorage";

/**
 * Options for compacting a conversation by persisting large tool outputs to storage
 * and replacing them with lightweight references.
 */
export interface CompactOptions {
  /**
   * Compaction strategy to use. Currently only "write-tool-results-to-storage" is supported.
   */
  strategy?: "write-tool-results-to-storage" | string;
  /**
   * Storage destination used to persist tool outputs. Accepts either a URI (e.g., "file:", "blob:")
   * or a StorageAdapter instance. If omitted, a default adapter may be created from the URI.
   */
  storage?: UriOrAdapter;
  /**
   * Controls where the compaction window starts. Defaults to "since-last-assistant-or-user-text".
   * You can also pass { type: "first-n-messages", count: N } to keep the first N messages intact.
   */
  boundary?: Boundary;
  /**
   * Function to convert tool outputs (objects) to strings before writing to storage.
   * Defaults to JSON.stringify(value, null, 2).
   */
  serializeResult?: (value: unknown) => string;
  /**
   * Tool names that are recognized as reading from storage (e.g., read/search tools). Their results
   * will not be re-written; instead, a friendly reference to the source is shown. Provide custom names
   * if you use your own read/search tools.
   */
  storageReaderToolNames?: string[];
}

/**
 * Compact a sequence of messages by writing large tool outputs to a configured storage and
 * replacing them with succinct references, keeping your model context lean.
 */
export async function compactMessages(
  messages: ModelMessage[],
  options: CompactOptions = {}
): Promise<ModelMessage[]> {
  const strategy = options.strategy ?? "write-tool-results-to-storage";
  // Default: compact only since the last assistant/user text turn
  const boundary: Boundary =
    options.boundary ?? "since-last-assistant-or-user-text";
  const adapter: StorageAdapter = createStorageAdapter(options.storage);
  const serializeResult =
    options.serializeResult ?? ((v) => JSON.stringify(v, null, 2));

  switch (strategy) {
    case "write-tool-results-to-storage":
      return await writeToolResultsToStorageStrategy(messages, {
        boundary,
        adapter,
        serializeResult,
        storageReaderToolNames: [
          "readFile",
          "grepAndSearchFile",
          ...(options.storageReaderToolNames ?? []),
        ],
      });
    default:
      throw new Error(`Unknown compaction strategy: ${strategy}`);
  }
}

export type { StorageAdapter } from "./storage/types";
export type { Boundary } from "./strategies/writeToolResultsToStorage";
