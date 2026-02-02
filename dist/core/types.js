"use strict";
/**
 * core/types.ts
 *
 * Single source of truth for every shared type in the project.
 * All modules import from here. Nothing defines its own DTOs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCorrelationId = generateCorrelationId;
// ---------------------------------------------------------------------------
// Utility: Correlation ID generation
// ---------------------------------------------------------------------------
function generateCorrelationId() {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
//# sourceMappingURL=types.js.map