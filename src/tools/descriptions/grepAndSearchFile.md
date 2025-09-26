Search a single file using grep-style matching. Returns matching lines with their line numbers. This tool is for searching, not for reading entire file contents.

- Provide `key` as the file's relative path (no scheme). The key is the file path, not any of the file's contents. Do NOT include `file://` or `blob://` in the key.
- Provide `storage` as a URI. If you are searching blob-backed objects, you MUST pass a blob URI (e.g., `blob:` or `blob:/my-prefix`). If `storage` is omitted, the tool defaults to searching the local filesystem.
- Provide `pattern` as a JavaScript regex (without slashes) and optional `flags` (e.g., `i`, `m`, `g`).

Storage URI formats:
- file: `file:///absolute/base/dir`
- blob (root): `blob:` or `blob://` or `blob:///`
- blob (with prefix): `blob:/my-prefix` or `blob:///my-prefix`

Examples:
- Local file:
  - storage: `file:///Users/me/project`
  - key: `out/2024-09-01.txt`
  - pattern: `ERROR|WARN`
  - flags: `i`
- Blob root:
  - storage: `blob:` (or `blob://`)
  - key: `c8c54006-628b-4ea5-854b-5099e980167f.txt`
  - pattern: `Los Angeles|temperature`
- Blob with prefix:
  - storage: `blob:/agent-outputs`
  - key: `2024/09/01/run-1.txt`
  - pattern: `^\d{4}-\d{2}-\d{2}`
  - flags: `m`

Notes:
- If you previously wrote output to blob storage, always include `storage: blob:` (or your blob prefix) when searching; otherwise it will attempt a local file search and may fail with ENOENT.
- Keys are resolved against the storage prefix/path. For blob root, the object path is just `key`. For blob prefixes, the stored path is `<prefix>/<key>`.
- If your object path contains subfolders, include them in `key` (e.g., `logs/2024/09/01.txt`).