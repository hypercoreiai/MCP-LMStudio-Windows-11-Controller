/**
 * core/registry.ts
 *
 * Central singleton. Responsibilities:
 *   - Holds every registered ToolModule.
 *   - Exposes list() for tools/list responses.
 *   - Resolves a tool name to its module.
 *   - Dispatches invocations through the TSD applier.
 *
 * Tool modules register themselves by calling ToolRegistry.register().
 * The server imports all tool modules at startup which triggers registration.
 */
import { ToolModule, ToolInvocation, ToolResult, OpenAIFunctionSchema, SessionConfig } from './types';
import { TsdLoader } from './tsd/loader';
export declare class ToolRegistry {
    /** The one and only instance. */
    private static instance;
    /** module name → ToolModule */
    private readonly modules;
    /** tool schema name → { module, schema } — fast lookup for dispatch */
    private readonly toolIndex;
    private tsdLoader;
    private sessionConfig;
    private initialized;
    private constructor();
    static getInstance(): ToolRegistry;
    /** Must be called once after construction, before any dispatch. */
    init(sessionConfig: SessionConfig, tsdLoader: TsdLoader): void;
    /** Check if registry is initialized before operations */
    private ensureInitialized;
    /**
     * Register a tool module. Called by each tool file on import.
     * Indexes every schema the module exposes for fast dispatch.
     */
    register(mod: ToolModule): void;
    /**
     * Returns all registered tool schemas in OpenAI function format.
     * This is what gets sent to the LLM so it knows what tools exist.
     */
    list(): OpenAIFunctionSchema[];
    /**
     * Returns just the tool names — used by the parser router's heuristic.
     */
    listToolNames(): string[];
    /**
     * Look up which module handles a given tool name.
     * Throws UnknownToolError if not found.
     */
    resolve(toolName: string): {
        module: ToolModule;
        schema: OpenAIFunctionSchema;
    };
    /**
     * The main dispatch entry point. Called by the server's request handler.
     *
     * Flow:
     *   1. Resolve the tool module
     *   2. Look up its TSD
     *   3. Hand off to the TSD applier, which wraps execute() with all policies
     */
    invoke(invocation: ToolInvocation): Promise<ToolResult>;
}
export declare const registry: ToolRegistry;
//# sourceMappingURL=registry.d.ts.map