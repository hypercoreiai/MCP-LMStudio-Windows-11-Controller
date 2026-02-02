/**
 * core/parser/embedding_parser.ts
 *
 * Handles models that embed tool invocations as XML tags inside their output:
 *     <tool_call>{"name":"file.read","arguments":{"path":"C:\\readme.txt"}}</tool_call>
 *
 * Responsibilities:
 *   - Find ALL <tool_call>…</tool_call> blocks in a (possibly streamed) string.
 *   - Extract and parse the JSON payload.
 *   - Handle edge cases: whitespace, partial chunks, nested quotes.
 *   - Return an array of ToolInvocation (a single model output can contain multiple calls).
 */
import { ToolInvocation } from '../types';
export interface EmbeddingParserResult {
    invocations: ToolInvocation[];
    /** Any text outside the tool_call tags (e.g. a conversational prefix). */
    remainingText: string;
}
/**
 * Parse a complete model output string for embedded tool calls.
 * Returns all found invocations plus any surrounding plain text.
 */
export declare function parseEmbeddedToolCalls(rawOutput: string): EmbeddingParserResult;
/**
 * Streaming-friendly variant. Call this repeatedly as chunks arrive.
 * It buffers internally and only emits a ToolInvocation once a complete
 * </tool_call> closing tag has been seen.
 */
export declare class EmbeddingParserStream {
    private buffer;
    /**
     * Feed a new chunk of streamed text. Returns any complete invocations
     * that can be extracted from the buffer so far.
     */
    feed(chunk: string): ToolInvocation[];
    /** Call when the stream ends to flush any remaining buffer. */
    flush(): {
        invocations: ToolInvocation[];
        remainingText: string;
    };
    /** Returns whatever is still buffered (incomplete tags, plain text). */
    getBuffer(): string;
}
//# sourceMappingURL=embedding_parser.d.ts.map