"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddingParserStream = void 0;
exports.parseEmbeddedToolCalls = parseEmbeddedToolCalls;
const errors_1 = require("../errors");
const logger_1 = require("../logger");
const log = (0, logger_1.scopedLogger)('core/parser/embedding_parser');
// Regex captures everything between <tool_call> and </tool_call>.
// The `s` flag makes `.` match newlines so multi-line payloads work.
const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
/**
 * Parse a complete model output string for embedded tool calls.
 * Returns all found invocations plus any surrounding plain text.
 */
function parseEmbeddedToolCalls(rawOutput) {
    const invocations = [];
    let remainingText = rawOutput;
    let match;
    // Reset lastIndex because the regex is stateful (global flag)
    TOOL_CALL_RE.lastIndex = 0;
    while ((match = TOOL_CALL_RE.exec(rawOutput)) !== null) {
        const rawJson = match[1].trim();
        let parsed;
        try {
            parsed = JSON.parse(rawJson);
        }
        catch {
            log.warn({ rawJson }, 'Failed to parse JSON inside <tool_call> tag');
            throw new errors_1.MalformedToolCallError(match[0]);
        }
        // Validate the minimum shape: must have a name
        if (!parsed.name || typeof parsed.name !== 'string') {
            throw new errors_1.MalformedToolCallError(match[0]);
        }
        const meta = {
            rawOutput,
            parserUsed: 'embedding',
            confidence: 1.0, // structural match — high confidence
            timestamp: Date.now()
        };
        invocations.push({
            tool: parsed.name,
            args: parsed.arguments ?? {},
            meta
        });
        // Strip the matched tag from remainingText
        remainingText = remainingText.replace(match[0], '').trim();
    }
    log.debug({ count: invocations.length }, 'Embedding parser extracted tool calls');
    return { invocations, remainingText };
}
/**
 * Streaming-friendly variant. Call this repeatedly as chunks arrive.
 * It buffers internally and only emits a ToolInvocation once a complete
 * </tool_call> closing tag has been seen.
 */
class EmbeddingParserStream {
    buffer = '';
    /**
     * Feed a new chunk of streamed text. Returns any complete invocations
     * that can be extracted from the buffer so far.
     */
    feed(chunk) {
        this.buffer += chunk;
        // Try to extract complete tags from the accumulated buffer
        const result = parseEmbeddedToolCalls(this.buffer);
        if (result.invocations.length > 0) {
            // Keep only the unprocessed remainder in the buffer
            this.buffer = result.remainingText;
        }
        return result.invocations;
    }
    /** Call when the stream ends to flush any remaining buffer. */
    flush() {
        const result = parseEmbeddedToolCalls(this.buffer);
        this.buffer = '';
        return result;
    }
    /** Returns whatever is still buffered (incomplete tags, plain text). */
    getBuffer() {
        return this.buffer;
    }
}
exports.EmbeddingParserStream = EmbeddingParserStream;
//# sourceMappingURL=embedding_parser.js.map