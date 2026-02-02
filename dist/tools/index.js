"use strict";
/**
 * tools/index.ts
 *
 * Import every tool module here. The act of importing triggers each
 * module's self-registration call (registry.register(…)) at the bottom
 * of its file.
 *
 * To add a new tool: create the module in this directory and add an
 * import line below. That's it — no other wiring needed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
require("./window_manager");
require("./file_manager");
require("./process_manager");
require("./input_handler");
require("./clipboard_manager");
require("./display_manager");
require("./registry_manager");
require("./scheduled_tasks");
require("./system_info");
require("./internet_tools");
require("./ui_inspector");
require("./memory_manager");
require("./agent_orchestrator");
require("./virtual_desktop_manager");
require("./shell_executor");
//# sourceMappingURL=index.js.map