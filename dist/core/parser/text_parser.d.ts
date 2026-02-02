/**
 * core/parser/text_parser.ts
 *
 * Handles models that do NOT emit <tool_call> tags.
 * These models might output tool calls as:
 *     - A fenced JSON block:  ```json { "tool": "...", "arguments": {...} } ```
 *     - Bare JSON anywhere in their response
 *     - Natural language that we can't parse (→ returned as plain text, no invocation)
 *
 * Strategy stack (tried in order, stops at first success):
 *     1. Fenced JSON block detection
 *     2. Bare JSON object detection (top-level {...})
 *     3. Known-tool heuristic — scans for a registered tool name and tries to
 *        reconstruct arguments from surrounding key-value-like text
 *
 * The registry reference is injected at runtime to avoid circular imports.
 */
import { ToolInvocation } from '../types';
export interface TextParserOptions {
    /**
     * List of known tool names from the registry.
     * Required for Strategy 3 (heuristic). Pass an empty array to disable it.
     */
    knownToolNames: string[];
}
export interface TextParserResult {
    invocation: ToolInvocation | null;
    rawText: string;
}
/**
 * Main entry point. Runs the strategy stack in order.
 */
export declare function parseTextToolCall(rawOutput: string, options: TextParserOptions): TextParserResult;
//# sourceMappingURL=text_parser.d.ts.map