/**
 * Service Definition for the spill storage capability seam (`ctx.spillStore`): an abstract service defining WHAT a
 * spill backend does — persist a tool's oversized text and return a model-facing
 * locator plus retrieval guidance — without saying HOW. Implementations
 * subclass {@link SpillStore} and register as the `spillStore` service;
 * `@deepseek-ai/dsh-spill-local` (host filesystem) is the first.
 *
 * The Service Definition is deliberately minimal: `saveText` and nothing else. It owns NO
 * retention policy (that is `@deepseek-ai/dsh-output-retention`), NO tool-result
 * replacement (that is `@deepseek-ai/dsh-spill-policy`), and NO retrieval or
 * search API. The backend supplies the locator and retrieval hint appropriate
 * for its storage substrate.
 *
 * @module @deepseek-ai/dsh-spill
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SaveTextSpill, SaveTextStreamSpill, SpillRef } from './types.ts'

export { SpillLocator } from './types.ts'
export type { SaveTextSpill, SaveTextStreamSpill, SpillOwner, SpillRef, SpillSource } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    spillStore: SpillStore
  }
}

/**
 * Abstract spill storage service. Subclass, implement {@link saveText}, and load
 * the subclass as a plugin — it registers as `ctx.spillStore` (one
 * implementation per context; loading a second throws, cordis' standard
 * duplicate-service behavior).
 *
 * Semantics every implementation must honor:
 * - {@link saveText} persists the FULL `content` verbatim and returns an opaque
 *   locator, exact byte length, and model-facing retrieval guidance.
 * - Storage is scoped by the request's {@link SaveTextSpill.owner} session; the
 *   backend chooses a private (not world-readable) location and a collision-free
 *   name derived from — never equal to — the caller's `suggestedName`.
 * - `saveText` REJECTS on a real storage failure (permissions, ENOSPC, backend
 *   unavailable); the caller decides how to degrade (the spill policy treats a
 *   rejection as best-effort and keeps the inline result).
 */
export abstract class SpillStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'spillStore')
  }

  /**
   * Persist `input.content` to a session-scoped spill artifact.
   * @param input - the owner, caller-supplied source fields, suggested name, and full text to save.
   * @returns the saved artifact's {@link SpillRef}; rejects on a storage failure.
   */
  abstract saveText(input: SaveTextSpill): Promise<SpillRef>

  /**
   * Persist ordered text chunks without requiring the caller to concatenate them.
   * The compatibility default materializes once and delegates to {@link saveText};
   * streaming backends override this method.
   * @param input - owner/source/name fields plus a single-consumption UTF-8 stream.
   * @returns the saved result reference; rejects on stream or storage failure.
   */
  async saveTextStream(input: SaveTextStreamSpill): Promise<SpillRef> {
    const chunks: string[] = []
    for await (const chunk of input.content) chunks.push(chunk)
    return this.saveText({
      owner: input.owner,
      source: input.source,
      suggestedName: input.suggestedName,
      content: chunks.join(''),
    })
  }
}

export default SpillStore
