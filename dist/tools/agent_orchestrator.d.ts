/**
 * tools/agent_orchestrator.ts
 *
 * Provides strategic planning for desktop automation tasks.
 * Converts natural language queries into detailed execution strategies
 * that a local LLM can follow using available MCP tools.
 *
 * Uses Qwen LLM for strategy generation. Does NOT execute tools directly.
 */
import { ToolModule } from '../core/types';
declare const agentOrchestrator: ToolModule;
export default agentOrchestrator;
//# sourceMappingURL=agent_orchestrator.d.ts.map