# Agent Note: Atomic streamed JSON spill

Status: implemented

English | [中文](2026-08-14-atomic-streamed-json-spill.zh.md)

## Problem

The [declarative JSON spill feature](../feature/2026-08-14-declarative-json-result-spill.md) fixes model exploration, but its post-execute implementation first materializes the complete JSON string and only then writes that string to storage. For a result much larger than the inline cap, this spends memory on both the validated canonical value and a second whole-result representation even though the model receives only a small notice.

Writing incrementally introduces a separate correctness risk: if the final locator names the file before serialization or storage finishes, concurrent readers can observe a syntactically incomplete JSON prefix. A failed serializer can also leave an apparently valid locator pointing at a partial file.

## Decision

Explicit JSON rendering gains one asynchronous `tools/render-json-output` waterfall after canonical value validation and before result content materialization. Its default preserves the existing `JSON.stringify` renderer. The spill policy listens there, serializes through an explicit work stack, and buffers chunks only until their UTF-8 size crosses `maxInlineBytes`. A within-cap result delegates to the remaining renderer chain and stays inline. An oversized result streams the buffered prefix and all subsequent chunks through `SpillStore.saveTextStream`, then returns the same schema-aware notice as the earlier feature.

The serializer matches `JSON.stringify(value, null, space)` for the lossless JSON vocabulary, including string escapes, lone surrogates, object key order, compact output, and indentation widths 1–10. It does not recurse through the value tree, and large strings and indentation are emitted in bounded chunks.

`SpillStore.saveTextStream` is an additive compatibility operation: its base implementation collects chunks and delegates to `saveText`, so existing backends remain source-compatible. The local backend overrides it. It writes to an unpredictable owner-only temporary inode in the destination session directory, closes the complete file, publishes the final random name with a no-clobber hard link, then attempts to remove the temporary link. Stream, write, close, or publish failure returns no locator; temporary-file cleanup is best effort after the primary outcome is known.

`saveText` uses the same local atomic path by adapting its materialized string to a one-chunk stream. The generic text spill policy and its model-visible behavior are unchanged.

## Alternatives considered

**Chunk the already-materialized JSON string.** Rejected because it changes write calls but not peak serialization memory. The complete string already exists before the first chunk reaches storage.

**Write directly to the final random path.** Rejected because unpredictable naming prevents collision attacks but does not prevent a reader that learned or observed the path from reading a partial file while the writer is active.

**Rename a temporary file over the final name.** A same-directory rename is atomic, but ordinary rename can replace an existing destination. Rejected in favor of a no-clobber hard-link publication that preserves the backend's existing exclusive-create guarantee.

**Use JSONL as the streaming format.** Rejected because JSONL changes the renderer contract and works naturally only for sequences. The saved bytes must remain exactly the declared JSON projection for every supported root.

**Make every spill backend implement streaming immediately.** Rejected because it would make an optimization a breaking service change. The base compatibility implementation preserves correctness while allowing capable backends to gain bounded memory.

## Consequences

- Oversized declared JSON no longer requires a whole serialized string in memory. Serializer buffering is bounded by the inline cap plus one bounded chunk; the canonical value still necessarily remains in memory for validation and programmatic consumers.
- Local final locators are atomic publication points: absent before completion and complete after publication. Temporary filenames are private implementation details and cleanup is best effort after success or failure.
- A non-streaming backend remains correct but does not gain the memory benefit because the compatibility implementation concatenates chunks. Backend capability is behavioral rather than advertised by a second service.
- JSON rendering is now asynchronous only at the registry's built-in declarative renderer boundary. Custom synchronous render functions and public `ToolExecutionResult` shapes remain unchanged.
- When streaming storage or notice construction fails, the policy invokes the ordinary whole-string renderer and keeps the result inline. This best-effort fallback can spend the original memory cost, but it preserves successful tool output instead of converting a storage optimization failure into a tool failure.
- Nested Code Mode dispatches keep their existing renderer and durable-log behavior; this decision does not stream values crossing the worker boundary.
