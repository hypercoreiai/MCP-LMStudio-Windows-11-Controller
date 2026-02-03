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

import {
  ToolModule,
  ToolInvocation,
  ToolResult,
  OpenAIFunctionSchema,
  SessionConfig
} from './types';
import { UnknownToolError } from './errors';
import { TsdLoader } from './tsd/loader';
import { applyTsd } from './tsd/applier';
import { scopedLogger } from './logger';

const log = scopedLogger('core/registry');

export class ToolRegistry {
  /** The one and only instance. */
  private static instance: ToolRegistry | null = null;

  /** module name → ToolModule */
  private readonly modules = new Map<string, ToolModule>();

  /** tool schema name → { module, schema } — fast lookup for dispatch */
  private readonly toolIndex = new Map<string, { module: ToolModule; schema: OpenAIFunctionSchema }>();

  private tsdLoader!: TsdLoader;
  private sessionConfig!: SessionConfig;
  private initialized = false;

  private constructor() {}

  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /** Must be called once after construction, before any dispatch. */
  init(sessionConfig: SessionConfig, tsdLoader: TsdLoader): void {
    if (this.initialized) {
      log.warn('Registry already initialized — ignoring duplicate init call');
      return;
    }
    this.sessionConfig = sessionConfig;
    this.tsdLoader = tsdLoader;
    this.initialized = true;
    log.info('Registry initialized successfully');
  }

  /** Check if registry is initialized before operations */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('ToolRegistry not initialized. Call init() before using the registry.');
    }
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register a tool module. Called by each tool file on import.
   * Indexes every schema the module exposes for fast dispatch.
   */
  register(mod: ToolModule): void {
    if (this.modules.has(mod.name)) {
      log.warn({ module: mod.name }, 'Module already registered — overwriting');
    }

    this.modules.set(mod.name, mod);

    for (const schema of mod.tools) {
      this.toolIndex.set(schema.name, { module: mod, schema });
    }

    log.info({ module: mod.name, tools: mod.tools.map(t => t.name) }, 'Tool module registered');
  }

  // -----------------------------------------------------------------------
  // Listing (for tools/list)
  // -----------------------------------------------------------------------

  /**
   * Returns all registered tool schemas in OpenAI function format.
   * This is what gets sent to the LLM so it knows what tools exist.
   */
  list(): OpenAIFunctionSchema[] {
    const schemas: OpenAIFunctionSchema[] = [];
    for (const mod of this.modules.values()) {
      schemas.push(...mod.tools);
    }
    return schemas;
  }

  /**
   * Returns just the tool names — used by the parser router's heuristic.
   */
  listToolNames(): string[] {
    return Array.from(this.toolIndex.keys());
  }

  // -----------------------------------------------------------------------
  // Resolution
  // -----------------------------------------------------------------------

  /**
   * Look up which module handles a given tool name.
   * Throws UnknownToolError if not found.
   */
  resolve(toolName: string): { module: ToolModule; schema: OpenAIFunctionSchema } {
    const entry = this.toolIndex.get(toolName);
    if (!entry) throw new UnknownToolError(toolName);
    return entry;
  }

  // -----------------------------------------------------------------------
  // Dispatch
  // -----------------------------------------------------------------------

  /**
   * The main dispatch entry point. Called by the server's request handler.
   * 
   * Flow:
   *   1. Resolve the tool module
   *   2. Look up its TSD
   *   3. Hand off to the TSD applier, which wraps execute() with all policies
   */
  async invoke(invocation: ToolInvocation): Promise<ToolResult> {
    this.ensureInitialized();
    const toolName = invocation.tool;
    const { module: mod } = this.resolve(toolName); // throws if unknown

    const tsd = this.tsdLoader.get(toolName);

    log.info({ tool: toolName, hasTsd: !!tsd }, 'Dispatching tool invocation');

    // The executeFn closure that the applier will call inside its retry loop
    const executeFn = async (_name: string, args: Record<string, unknown>): Promise<ToolResult> => {
      const start = Date.now();
      try {
        const result = await mod.execute(toolName, args);
        result.durationMs = Date.now() - start;
        return result;
      } catch (e) {
        return {
          success: false,
          error: {
            code: (e as any).code ?? 'EXECUTION_ERROR',
            message: (e as Error).message
          },
          durationMs: Date.now() - start
        };
      }
    };

    // Fallback executor — re-invokes through the registry so the fallback
    // tool also gets its own TSD treatment
    const fallbackFn = async (fallbackToolName: string, args: Record<string, unknown>): Promise<ToolResult> => {
      return this.invoke({ tool: fallbackToolName, args, meta: invocation.meta });
    };

    return applyTsd(invocation, tsd, this.sessionConfig, executeFn, fallbackFn);
  }
}

// Convenience export so tool modules can do:
//     import { registry } from '@core/registry';
//     registry.register(myModule);
export const registry = ToolRegistry.getInstance();
