"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParserRouter = void 0;
const embedding_parser_1 = require("./embedding_parser");
const text_parser_1 = require("./text_parser");
const logger_1 = require("../logger");
const log = (0, logger_1.scopedLogger)('core/parser/router');
class ParserRouter {
    mode;
    knownToolNames = [];
    constructor(sessionConfig) {
        if (sessionConfig.modelSupportsToolCallTags === true) {
            this.mode = 'embedding';
        }
        else if (sessionConfig.modelSupportsToolCallTags === false) {
            this.mode = 'text';
        }
        else {
            this.mode = 'hybrid';
        }
        log.info({ mode: this.mode }, 'Parser router initialised');
    }
    /**
     * Must be called once after the tool registry is populated.
     * Gives the text parser's heuristic strategy access to known names.
     */
    setKnownToolNames(names) {
        this.knownToolNames = names;
    }
    /**
     * Main dispatch. Returns all tool invocations found in the output.
     * An empty array means the output was a plain assistant message.
     */
    parse(rawOutput) {
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
    runEmbedding(rawOutput) {
        const { invocations } = (0, embedding_parser_1.parseEmbeddedToolCalls)(rawOutput);
        return invocations;
    }
    runText(rawOutput) {
        const { invocation } = (0, text_parser_1.parseTextToolCall)(rawOutput, {
            knownToolNames: this.knownToolNames
        });
        return invocation ? [invocation] : [];
    }
    runHybrid(rawOutput) {
        // Try embedding first
        const { invocations } = (0, embedding_parser_1.parseEmbeddedToolCalls)(rawOutput);
        if (invocations.length > 0) {
            log.debug('Hybrid: matched via embedding parser');
            return invocations;
        }
        // Fall through to text
        log.debug('Hybrid: no tags found, falling through to text parser');
        return this.runText(rawOutput);
    }
}
exports.ParserRouter = ParserRouter;
//# sourceMappingURL=router.js.map