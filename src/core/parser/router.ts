/**
 * core/parser/router.ts
 * 
 * Decides which parser handles a given model output.
 * 
 * Three modes:
 *   "embedding"  — always use the <tool_call> tag parser
 *   "text"       — always use the plain-text strategy stack
 *   "hybrid"     — (DEFAULT) try embedding first; if no tags found, fall through to text
 * 
 * The mode is determined once per session from SessionConfig.modelSupportsToolCallTags:
 *     true      → "embedding"
 *     false     → "text"
 *     undefined → "hybrid"
 */

import { ToolInvocation, SessionConfig } from '../types';
import { parseEmbeddedToolCalls } from './embedding_parser';
import { parseTextToolCall } from './text_parser';
import { scopedLogger } from '../logger';

const log = scopedLogger('core/parser/router');

export type ParserMode = 'embedding' | 'text' | 'hybrid';

export class ParserRouter {
  private readonly mode: ParserMode;
  private knownToolNames: string[] = [];

  constructor(sessionConfig: SessionConfig) {
    if (sessionConfig.modelSupportsToolCallTags === true) {
      this.mode = 'embedding';
    } else if (sessionConfig.modelSupportsToolCallTags === false) {
      this.mode = 'text';
    } else {
      this.mode = 'hybrid';
    }
    log.info({ mode: this.mode }, 'Parser router initialised');
  }

  /**
   * Must be called once after the tool registry is populated.
   * Gives the text parser's heuristic strategy access to known names.
   */
  setKnownToolNames(names: string[]): void {
    this.knownToolNames = names;
  }

  /**
   * Main dispatch. Returns all tool invocations found in the output.
   * An empty array means the output was a plain assistant message.
   */
  parse(rawOutput: string): ToolInvocation[] {
    switch (this.mode) {
      case 'embedding':
        return this.runEmbedding(rawOutput);

      case 'text':
        return this.runText(rawOutput);

      case 'hybrid':
      default:
        return this.runHybrid(rawOutput);
    }
  }

  // -----------------------------------------------------------------------
  // Private dispatch helpers
  // -----------------------------------------------------------------------

  private runEmbedding(rawOutput: string): ToolInvocation[] {
    const { invocations } = parseEmbeddedToolCalls(rawOutput);
    return invocations;
  }

  private runText(rawOutput: string): ToolInvocation[] {
    const { invocation } = parseTextToolCall(rawOutput, {
      knownToolNames: this.knownToolNames
    });
    return invocation ? [invocation] : [];
  }

  private runHybrid(rawOutput: string): ToolInvocation[] {
    // Try embedding first
    const { invocations } = parseEmbeddedToolCalls(rawOutput);

    if (invocations.length > 0) {
      log.debug('Hybrid: matched via embedding parser');
      return invocations;
    }

    // Fall through to text
    log.debug('Hybrid: no tags found, falling through to text parser');
    return this.runText(rawOutput);
  }
}
