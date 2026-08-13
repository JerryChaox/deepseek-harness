# @deepseek-ai/dsh-spill-local

English | [中文](README.zh.md)

The **local-filesystem** implementation of the [`@deepseek-ai/dsh-spill`](../spill) storage seam. Registers as `ctx.spillStore` and persists a tool's oversized text to a private, session-scoped file; its locator is the file path and its retrieval hint tells the model to use `read` or `grep` on that path.

## Storage layout

Files land at `<root>/session-<hash>/​<random>-<safeName>`:

- **`root`** — the config `root` (resolved to absolute), or a lazily-created private (0700) per-process directory under the OS temp dir when omitted. A predictable, world-readable root would let other local users read spilled tool output or plant symlinks.
- **`session-<hash>`** — a short `sha256(sessionId)` prefix, so a session's spill files group together and a future cleanup can drop them per session.
- **`<random>-<safeName>`** — an unpredictable hex prefix plus the caller's `suggestedName` sanitized to one safe segment. Writes first use an owner-only unpredictable `.tmp-*` inode in the same private session directory; after complete write and close, a no-clobber hard link atomically publishes the final name and the temporary link is removed. A reader can therefore observe no final locator or the complete bytes, never a partially written final file.

## Config

| Key | Default | Meaning |
|---|---|---|
| `root` | private 0700 temp dir | Root directory for spill files. Set to keep them under a known location. |

`saveText` and `saveTextStream` reject on a real storage or input-stream failure. Failed stream saves remove their private temporary file and never publish a final locator. The spill policy treats rejection as best-effort and keeps the ordinary inline renderer result.

## Model Experience

Indirectly, through spill consumers that render the local path and `read`/`grep` retrieval guidance.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Local spill files persist until external cleanup** — the backend has no session-lifecycle deletion or age-based retention policy, because persisted, resumed, and forked sessions may still reference a path.
- **Locators require a co-located filesystem consumer** — a remote or virtual deployment needs another `SpillStore` backend whose locator and retrieval hint are meaningful there.
