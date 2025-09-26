import { head, put } from "@vercel/blob";
import type { ReadStream } from "node:fs";
import { Readable } from "node:stream";
import type {
  StorageAdapter,
  StorageReadParams,
  StorageWriteParams,
  StorageWriteResult,
} from "./types";

export interface VercelBlobStorageOptions {
  prefix?: string;
  access?: "public";
}

export class VercelBlobStorageAdapter implements StorageAdapter {
  private prefix: string;
  private access: "public";

  constructor(options: VercelBlobStorageOptions = {}) {
    this.prefix = options.prefix ?? "";
    this.access = options.access ?? "public";
  }

  resolveKey(name: string): string {
    const safe = name.replace(/\\/g, "/").replace(/\.+\//g, "");
    return this.prefix ? `${this.prefix.replace(/\/$/, "")}/${safe}` : safe;
  }

  async write(params: StorageWriteParams): Promise<StorageWriteResult> {
    const body =
      typeof params.body === "string" ? params.body : Buffer.from(params.body);
    const result: any = await put(params.key, body, {
      access: this.access,
      contentType: params.contentType,
      // Ensure the stored object path matches the requested key
      addRandomSuffix: false,
    });
    // Use actual stored pathname as the effective key
    const effectiveKey =
      typeof result?.pathname === "string" ? result.pathname : params.key;
    return { key: effectiveKey, url: result.url };
  }

  async readText(params: StorageReadParams): Promise<string> {
    const resolvedKey = this.resolveKey(params.key);
    const meta = await head(resolvedKey);
    const url = (meta as any).downloadUrl || meta.url;
    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`Failed to read blob: ${resolvedKey} (${res.status})`);
    return await res.text();
  }

  async openReadStream(
    params: StorageReadParams
  ): Promise<NodeJS.ReadableStream | ReadStream> {
    const resolvedKey = this.resolveKey(params.key);
    const meta = await head(resolvedKey);
    const url = (meta as any).downloadUrl || meta.url;
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new Error(
        `Failed to open blob stream: ${resolvedKey} (${res.status})`
      );
    }
    // Convert Web ReadableStream to NodeJS.ReadableStream
    return Readable.fromWeb(res.body as any);
  }

  toString(): string {
    const prefix = this.prefix ?? "";
    if (!prefix) return "blob:";
    return `blob://${prefix}`.replace(/\/$/, "");
  }
}

export function vercelBlobUriToOptions(uri: string): VercelBlobStorageOptions {
  // Support blob root and path forms: blob:, blob:/, blob://, blob:///, blob:/prefix, blob:///prefix
  if (
    uri === "blob:" ||
    uri === "blob:/" ||
    uri === "blob://" ||
    uri === "blob:///"
  ) {
    return {};
  }
  const url = new URL(uri);
  if (url.protocol !== "blob:") {
    throw new Error(`Invalid blob URI: ${uri}`);
  }
  const prefix = url.pathname.replace(/^\//, "");
  return { prefix };
}
