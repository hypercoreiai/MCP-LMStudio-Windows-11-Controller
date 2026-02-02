/**
 * tools/file_manager.ts
 *
 * Full filesystem control. Uses Node's fs module directly for most operations
 * (fast, no subprocess overhead). Falls back to shell commands only when
 * shell expansion or OS-level behaviour is needed (e.g. opening with default app).
 *
 * Path sandboxing is enforced: if the session config specifies allowed prefixes,
 * any path outside them is rejected before any I/O happens.
 */
import { ToolModule } from '../core/types';
declare const fileManager: ToolModule;
export default fileManager;
//# sourceMappingURL=file_manager.d.ts.map