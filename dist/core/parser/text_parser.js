"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTextToolCall = parseTextToolCall;
const logger_1 = require("../logger");
const log = (0, logger_1.scopedLogger)('core/parser/text_parser');
// ---------------------------------------------------------------------------
// Strategy 1: Fenced JSON block  (```json … ```)
// ---------------------------------------------------------------------------
const FENCED_JSON_RE = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g;
function tryFencedJson(rawOutput) {
    FENCED_JSON_RE.lastIndex = 0;
    let match;
    while ((match = FENCED_JSON_RE.exec(rawOutput)) !== null) {
        const candidate = tryParseToolPayload(match[1].trim(), rawOutput);
        if (candidate) {
            log.debug('Extracted tool call from fenced JSON block');
            return candidate;
        }
    }
    return null;
}
// ---------------------------------------------------------------------------
// Strategy 2: Bare JSON object anywhere in the output
// ---------------------------------------------------------------------------
/**
 * Finds the first top-level {...} in the string and tries to parse it.
 * Uses a simple brace-depth counter so nested objects don't confuse it.
 */
function tryBareJson(rawOutput) {
    const start = rawOutput.indexOf('{');
    if (start === -1)
        return null;
    let depth = 0;
    let end = -1;
    for (let i = start; i < rawOutput.length; i++) {
        if (rawOutput[i] === '{')
            depth++;
        else if (rawOutput[i] === '}') {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    if (end === -1)
        return null; // unclosed brace
    const candidate = tryParseToolPayload(rawOutput.slice(start, end + 1), rawOutput);
    if (candidate) {
        log.debug('Extracted tool call from bare JSON object');
    }
    return candidate;
}
// ---------------------------------------------------------------------------
// Strategy 3: Known-tool heuristic
// ---------------------------------------------------------------------------
/**
 * Scans the output for any known tool name (e.g. "file.read") and, if found,
 * attempts a best-effort extraction of arguments.
 *
 * @param knownToolNames - injected from the registry at runtime
 */
function tryKnownToolHeuristic(rawOutput, knownToolNames) {
    const lowerOutput = rawOutput.toLowerCase();
    // Find the first known tool name mentioned anywhere in the text
    let bestMatch = null;
    for (const name of knownToolNames) {
        const idx = lowerOutput.indexOf(name.toLowerCase());
        if (idx !== -1 && (bestMatch === null || idx < bestMatch.index)) {
            bestMatch = { name, index: idx };
        }
    }
    if (!bestMatch)
        return null;
    // Try to find a JSON object AFTER the tool name mention
    const after = rawOutput.slice(bestMatch.index + bestMatch.name.length);
    const braceStart = after.indexOf('{');
    let args = {};
    let confidence = 0.4; // low — heuristic match without clean JSON args
    if (braceStart !== -1) {
        // Attempt to parse whatever JSON-like block follows
        let depth = 0;
        let end = -1;
        for (let i = braceStart; i < after.length; i++) {
            if (after[i] === '{')
                depth++;
            else if (after[i] === '}') {
                depth--;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }
        if (end !== -1) {
            try {
                args = JSON.parse(after.slice(braceStart, end + 1));
                confidence = 0.7; // better — we found structured args
            }
            catch {
                // JSON was malformed; proceed with empty args at low confidence
            }
        }
    }
    log.debug({ tool: bestMatch.name, confidence }, 'Heuristic match found');
    const meta = {
        rawOutput,
        parserUsed: 'text',
        confidence,
        timestamp: Date.now()
    };
    return {
        tool: bestMatch.name,
        args,
        meta
    };
}
// ---------------------------------------------------------------------------
// Shared helper: parse a JSON string and validate it looks like a tool call
// ---------------------------------------------------------------------------
/**
 * Accepted shapes:
 *     { "name": "tool.name", "arguments": {...} }          ← OpenAI style
 *     { "tool": "tool.name", "arguments": {...} }          ← common variant
 *     { "tool": "tool.name", "args": {...} }               ← shorthand variant
 *     { "function": { "name": "…", "arguments": {...} } }  ← nested OpenAI style
 */
function tryParseToolPayload(json, rawOutput) {
    let obj;
    try {
        obj = JSON.parse(json);
    }
    catch {
        return null;
    }
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj))
        return null;
    let toolName;
    let toolArgs = {};
    // Shape 1: top-level name / tool key
    if (typeof obj.name === 'string') {
        toolName = obj.name;
        toolArgs = obj.arguments ?? obj.args ?? {};
    }
    else if (typeof obj.tool === 'string') {
        toolName = obj.tool;
        toolArgs = obj.arguments ?? obj.args ?? {};
    }
    // Shape 2: nested under "function"
    else if (typeof obj.function === 'object' && obj.function !== null) {
        const fn = obj.function;
        if (typeof fn.name === 'string') {
            toolName = fn.name;
            toolArgs = fn.arguments ?? {};
        }
    }
    if (!toolName)
        return null;
    const meta = {
        rawOutput,
        parserUsed: 'text',
        confidence: 0.9, // structured JSON match
        timestamp: Date.now()
    };
    return { tool: toolName, args: toolArgs, meta };
}
/**
 * Main entry point. Runs the strategy stack in order.
 */
function parseTextToolCall(rawOutput, options) {
    // Strategy 1
    const fenced = tryFencedJson(rawOutput);
    if (fenced)
        return { invocation: fenced, rawText: rawOutput };
    // Strategy 2
    const bare = tryBareJson(rawOutput);
    if (bare)
        return { invocation: bare, rawText: rawOutput };
    // Strategy 3
    if (options.knownToolNames.length > 0) {
        const heuristic = tryKnownToolHeuristic(rawOutput, options.knownToolNames);
        if (heuristic)
            return { invocation: heuristic, rawText: rawOutput };
    }
    // Nothing found — this is a plain assistant message, not a tool call
    log.debug('No tool call detected in output; returning as plain text');
    return { invocation: null, rawText: rawOutput };
}
//# sourceMappingURL=text_parser.js.map