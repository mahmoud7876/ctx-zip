Read the full contents of a single file from storage. This is not a search tool.

- Provide `key` as the file's relative path (no scheme). The key is the file path, not any of the file's contents. Do NOT include `file://` or `blob://` in the key.
- Provide `storage` as a URI. If you are reading blob-backed objects, you MUST pass a blob URI (e.g., `blob:` or `blob:/my-prefix`). If `storage` is omitted, the tool defaults to reading from the local filesystem.

Storage URI formats:
- file: `file:///absolute/base/dir`
- blob (root): `blob:` or `blob://` or `blob:///`
- blob (with prefix): `blob:/my-prefix` or `blob:///my-prefix`

Examples:
- Local file:
  - storage: `file:///Users/me/project`
  - key: `out/2024-09-01.txt`
- Blob root:
  - storage: `blob:` (or `blob://`)
  - key: `c8c54006-628b-4ea5-854b-5099e980167f.txt`
- Blob with prefix:
  - storage: `blob:/agent-outputs`
  - key: `2024/09/01/run-1.txt`

Notes:
- Use only when the target file/blob was previously written in this conversation. It cannot access arbitrary files outside the conversation history.
- Do not guess storage keys or filenames. Use only keys/references surfaced in conversation. If the data is not present, re-run the original producing tool to generate and persist it before reading.
- If you previously wrote output to blob storage, always include `storage: blob:` (or your blob prefix) when reading; otherwise it will attempt a local file read and may fail with ENOENT.
- Keys are resolved against the storage prefix/path. For blob root, the object path is just `key`. For blob prefixes, the stored path is `<prefix>/<key>`.
- If your object path contains subfolders, include them in `key` (e.g., `logs/2024/09/01.txt`).

