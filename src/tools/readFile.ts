import { tool } from "ai";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { FileStorageAdapter } from "../storage/file";
import { createStorageAdapter } from "../storage/resolver";

export interface ReadFileToolOptions {
  description?: string;
  baseDir?: string;
}

const defaultDescription = readFileSync(
  new URL("./descriptions/readFile.md", import.meta.url),
  "utf-8"
);

export function createReadFileTool(options: ReadFileToolOptions = {}) {
  return tool({
    description: options.description ?? defaultDescription,
    inputSchema: z.object({
      key: z
        .string()
        .describe(
          "Relative storage key/path to read (no scheme). For file:// it is under the base dir; for blob:// it is under the prefix."
        ),
      storage: z
        .string()
        .describe(
          "Storage URI. Use file:///abs/dir for local file storage, or blob://prefix for blob storage. This is required and has no default."
        ),
    }),
    async execute({ key, storage }) {
      try {
        const adapter = storage
          ? createStorageAdapter(storage)
          : options.baseDir
          ? new FileStorageAdapter({ baseDir: options.baseDir })
          : createStorageAdapter();

        if (!adapter.readText) {
          return {
            key,
            content:
              "No readText method found in storage adapter. Are you sure the storage is correct? If yes, make the original tool call again with the same arguments instead of relying on readFile or grepAndSearchFile.",
            storage: adapter.toString(),
          };
        }
        const content = await adapter.readText({ key });
        return { key, content, storage: adapter.toString() };
      } catch (err) {
        return {
          key,
          content: `Error reading file: ${
            (err as Error).message
          }. Are you sure the storage is correct? If yes, make the original tool call again with the same arguments instead of relying on readFile or grepAndSearchFile.`,
        };
      }
    },
  });
}
