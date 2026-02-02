/**
 * core/server.ts
 *
 * The single entry point. Orchestrates startup in order:
 *   1. Load environment variables from .env
 *   2. Parse CLI args → determine transport mode
 *   3. Load session config (from config/session.json + CLI overrides)
 *   4. Initialise the logger
 *   5. Load TSDs from config/tsds/
 *   6. Import all tool modules (triggers self-registration)
 *   7. Initialise the registry with the TSD loader
 *   8. Create the parser router, feed it known tool names
 *   9. Start the selected transport
 */
export {};
//# sourceMappingURL=server.d.ts.map