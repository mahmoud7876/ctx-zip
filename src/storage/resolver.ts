import path from "node:path";
import { FileStorageAdapter, fileUriToOptions } from "./file";
import type { StorageAdapter, UriOrAdapter } from "./types";
import { VercelBlobStorageAdapter, vercelBlobUriToOptions } from "./vercelBlob";

export function createStorageAdapter(
  uriOrAdapter?: UriOrAdapter
): StorageAdapter {
  if (typeof uriOrAdapter === "object" && uriOrAdapter) return uriOrAdapter;
  const uri = typeof uriOrAdapter === "string" ? uriOrAdapter : undefined;
  if (!uri) {
    return new FileStorageAdapter({ baseDir: process.cwd() });
  }
  const lower = uri.toLowerCase();
  if (lower.startsWith("file:")) {
    const options = fileUriToOptions(uri);
    return new FileStorageAdapter(options);
  }
  if (lower.startsWith("blob:")) {
    const options = vercelBlobUriToOptions(uri);
    return new VercelBlobStorageAdapter(options);
  }
  throw new Error(`Unsupported storage URI: ${uri}`);
}

export function resolveFileUriFromBaseDir(baseDir: string): string {
  const abs = path.resolve(baseDir);
  return `file://${abs}`;
}
