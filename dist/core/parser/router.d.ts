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
export type ParserMode = 'embedding' | 'text' | 'hybrid';
export declare class ParserRouter {
    private readonly mode;
    private knownToolNames;
    constructor(sessionConfig: SessionConfig);
    /**
     * Must be called once after the tool registry is populated.
     * Gives the text parser's heuristic strategy access to known names.
     */
    setKnownToolNames(names: string[]): void;
    /**
     * Main dispatch. Returns all tool invocations found in the output.
     * An empty array means the output was a plain assistant message.
     */
    parse(rawOutput: string): ToolInvocation[];
    private runEmbedding;
    private runText;
    private runHybrid;
}
//# sourceMappingURL=router.d.ts.map