import fs from "node:fs";
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  StorageAdapter,
  StorageReadParams,
  StorageWriteParams,
  StorageWriteResult,
} from "./types";

export interface FileStorageOptions {
  baseDir: string; // absolute directory
  prefix?: string; // optional subdir/prefix inside baseDir
}

export class FileStorageAdapter implements StorageAdapter {
  private baseDir: string;
  private prefix: string;

  constructor(options: FileStorageOptions) {
    this.baseDir = options.baseDir;
    this.prefix = options.prefix ?? "";
  }

  resolveKey(name: string): string {
    const safe = name.replace(/\\/g, "/").replace(/\.+\//g, "");
    return this.prefix ? `${this.prefix.replace(/\/$/, "")}/${safe}` : safe;
  }

  async write(params: StorageWriteParams): Promise<StorageWriteResult> {
    const fullPath = path.resolve(this.baseDir, params.key);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    const body =
      typeof params.body === "string" ? params.body : Buffer.from(params.body);
    await fsWriteFile(fullPath, body, "utf8");
    const url = new URL(`file://${fullPath}`);
    return { key: params.key, url: url.toString() };
  }

  async readText(params: StorageReadParams): Promise<string> {
    const fullPath = path.resolve(this.baseDir, params.key);
    return await fsReadFile(fullPath, "utf8");
  }

  async openReadStream(params: StorageReadParams) {
    const fullPath = path.resolve(this.baseDir, params.key);
    return fs.createReadStream(fullPath);
  }

  toString(): string {
    return `file://${this.baseDir}${this.prefix ? "/" + this.prefix : ""}`;
  }
}

export function fileUriToOptions(uri: string): FileStorageOptions {
  // Expect file:///abs/path or file:/abs/path
  const url = new URL(uri);
  if (url.protocol !== "file:") {
    throw new Error(`Invalid file URI: ${uri}`);
  }
  const baseDir = fileURLToPath(url);
  return { baseDir };
}
