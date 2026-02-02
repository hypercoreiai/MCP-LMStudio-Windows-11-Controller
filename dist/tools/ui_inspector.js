"use strict";
/**
 * tools/ui_inspector.ts
 *
 * Provides UI Automation (UIA) capabilities for inspecting and interacting
 * with Windows UI elements. Uses PowerShell with UIAutomation assemblies
 * for deep UI control, similar to Python's uiautomation library.
 *
 * Note: Requires Windows UIAutomation assemblies. Falls back gracefully
 * if unavailable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const registry_1 = require("../core/registry");
const errors_1 = require("../core/errors");
const logger_1 = require("../core/logger");
const log = (0, logger_1.scopedLogger)('tools/ui_inspector');
// ---------------------------------------------------------------------------
// PowerShell helper with UIA
// ---------------------------------------------------------------------------
function ps(script, timeoutMs = 15000) {
    try {
        // Use UTF-8 encoding and execute script directly
        const result = (0, child_process_1.execSync)(script, {
            encoding: 'utf-8',
            timeout: timeoutMs,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: 'powershell.exe'
        });
        return result.trim();
    }
    catch (error) {
        log.error({ error: error.message, stderr: error.stderr?.toString() }, 'PowerShell execution failed');
        return '';
    }
}
// ---------------------------------------------------------------------------
// Internal handlers
// ---------------------------------------------------------------------------
async function handleUIListElements(args) {
    const rootHandle = args.rootHandle;
    const maxDepth = args.maxDepth ?? 3;
    const script = `
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    function Get-UIElements {
      param(
        [System.Windows.Automation.AutomationElement]$Element,
        [int]$Depth,
        [int]$MaxDepth
      )
      if ($Depth -gt $MaxDepth) { return }

      $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
      $child = $walker.GetFirstChild($Element)

      $results = @()
      while ($child) {
        $info = @{
          Name = $child.Current.Name
          AutomationId = $child.Current.AutomationId
          ClassName = $child.Current.ClassName
          ControlType = $child.Current.ControlType.ProgrammaticName
          IsEnabled = $child.Current.IsEnabled
          IsOffscreen = $child.Current.IsOffscreen
          Depth = $Depth
        }
        $results += $info

        $childElements = Get-UIElements -Element $child -Depth ($Depth + 1) -MaxDepth $MaxDepth
        $results += $childElements

        $child = $walker.GetNextSibling($child)
      }
      return $results
    }

    $root = ${rootHandle ? `[System.Windows.Automation.AutomationElement]::FromHandle(${rootHandle})` : '[System.Windows.Automation.AutomationElement]::RootElement'}
    $elements = Get-UIElements -Element $root -Depth 0 -MaxDepth ${maxDepth}
    $elements | ConvertTo-Json -Depth 10
  `;
    const raw = ps(script, 30000);
    let elements = [];
    try {
        const parsed = JSON.parse(raw || '[]');
        elements = Array.isArray(parsed) ? parsed : [parsed];
    }
    catch (error) {
        log.warn({ error: error.message }, 'Failed to parse UI elements');
    }
    return { success: true, data: { elements, count: elements.length }, durationMs: 0 };
}
async function handleUIGetElement(args) {
    const automationId = args.automationId;
    const name = args.name;
    const className = args.className;
    const rootHandle = args.rootHandle;
    const script = `
    $root = ${rootHandle ? `[System.Windows.Automation.AutomationElement]::FromHandle(${rootHandle})` : '[System.Windows.Automation.AutomationElement]::RootElement'};
    $conditions = @();

    if ('${automationId}') {
      $conditions += [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '${automationId}');
    }
    if ('${name}') {
      $conditions += [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '${name}');
    }
    if ('${className}') {
      $conditions += [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, '${className}');
    }

    $condition = $null;
    if ($conditions.Count -eq 1) {
      $condition = $conditions[0];
    } elseif ($conditions.Count -gt 1) {
      $condition = [System.Windows.Automation.AndCondition]::new($conditions);
    } else {
      $condition = [System.Windows.Automation.Condition]::TrueCondition;
    }

    $element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition);
    if ($element) {
      @{
        Name = $element.Current.Name;
        AutomationId = $element.Current.AutomationId;
        ClassName = $element.Current.ClassName;
        ControlType = $element.Current.ControlType.ProgrammaticName;
        BoundingRectangle = $element.Current.BoundingRectangle.ToString();
        IsEnabled = $element.Current.IsEnabled;
        IsOffscreen = $element.Current.IsOffscreen;
        Value = $element.GetCurrentPropertyValue([System.Windows.Automation.ValuePattern]::ValueProperty);
      } | ConvertTo-Json;
    } else {
      '{}';
    }
  `;
    const raw = ps(script);
    let element;
    try {
        element = JSON.parse(raw || '{}');
    }
    catch {
        element = {};
    }
    return { success: true, data: { element }, durationMs: 0 };
}
async function handleUIClickElement(args) {
    const automationId = args.automationId;
    const name = args.name;
    const className = args.className;
    const rootHandle = args.rootHandle;
    const script = `
    $root = ${rootHandle ? `[System.Windows.Automation.AutomationElement]::FromHandle(${rootHandle})` : '[System.Windows.Automation.AutomationElement]::RootElement'};
    $conditions = @();

    if ('${automationId}') {
      $conditions += [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '${automationId}');
    }
    if ('${name}') {
      $conditions += [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '${name}');
    }
    if ('${className}') {
      $conditions += [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, '${className}');
    }

    $condition = $null;
    if ($conditions.Count -eq 1) {
      $condition = $conditions[0];
    } elseif ($conditions.Count -gt 1) {
      $condition = [System.Windows.Automation.AndCondition]::new($conditions);
    } else {
      $condition = [System.Windows.Automation.Condition]::TrueCondition;
    }

    $element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition);
    if ($element) {
      $invokePattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern);
      if ($invokePattern) {
        $invokePattern.Invoke();
        'Invoked';
      } else {
        $rect = $element.Current.BoundingRectangle;
        $x = $rect.X + $rect.Width / 2;
        $y = $rect.Y + $rect.Height / 2;
        [System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new($x, $y);
        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}');
        'Clicked via cursor';
      }
    } else {
      throw 'Element not found';
    }
  `;
    ps(script);
    return { success: true, data: { clicked: true }, durationMs: 0 };
}
async function handleUITypeIntoElement(args) {
    const automationId = args.automationId;
    const name = args.name;
    const className = args.className;
    const text = args.text;
    const rootHandle = args.rootHandle;
    const script = `
    $root = ${rootHandle ? `[System.Windows.Automation.AutomationElement]::FromHandle(${rootHandle})` : '[System.Windows.Automation.AutomationElement]::RootElement'};
    $conditions = @();

    if ('${automationId}') {
      $conditions += [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '${automationId}');
    }
    if ('${name}') {
      $conditions += [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '${name}');
    }
    if ('${className}') {
      $conditions += [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, '${className}');
    }

    $condition = $null;
    if ($conditions.Count -eq 1) {
      $condition = $conditions[0];
    } elseif ($conditions.Count -gt 1) {
      $condition = [System.Windows.Automation.AndCondition]::new($conditions);
    } else {
      $condition = [System.Windows.Automation.Condition]::TrueCondition;
    }

    $element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition);
    if ($element) {
      $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);
      if ($valuePattern) {
        $valuePattern.SetValue('${text}');
        'Typed via ValuePattern';
      } else {
        $rect = $element.Current.BoundingRectangle;
        $x = $rect.X + $rect.Width / 2;
        $y = $rect.Y + $rect.Height / 2;
        [System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new($x, $y);
        [System.Windows.Forms.SendKeys]::SendWait('${text}');
        'Typed via cursor';
      }
    } else {
      throw 'Element not found';
    }
  `;
    ps(script);
    return { success: true, data: { typed: true }, durationMs: 0 };
}
// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------
const uiInspector = {
    name: 'ui_inspector',
    tools: [
        {
            name: 'ui.list_elements',
            description: 'List UI elements in a window or the desktop, up to a maximum depth.',
            parameters: {
                type: 'object',
                properties: {
                    rootHandle: { type: 'number', description: 'Window handle to search from (optional, defaults to desktop root)' },
                    maxDepth: { type: 'number', description: 'Maximum depth to traverse (default: 3)', default: 3 }
                }
            }
        },
        {
            name: 'ui.get_element',
            description: 'Find and get properties of a specific UI element by automation ID, name, or class name.',
            parameters: {
                type: 'object',
                properties: {
                    automationId: { type: 'string', description: 'Automation ID of the element' },
                    name: { type: 'string', description: 'Name of the element' },
                    className: { type: 'string', description: 'Class name of the element' },
                    rootHandle: { type: 'number', description: 'Window handle to search from (optional)' }
                }
            }
        },
        {
            name: 'ui.click_element',
            description: 'Click on a UI element (invoke or simulate click).',
            parameters: {
                type: 'object',
                properties: {
                    automationId: { type: 'string', description: 'Automation ID of the element' },
                    name: { type: 'string', description: 'Name of the element' },
                    className: { type: 'string', description: 'Class name of the element' },
                    rootHandle: { type: 'number', description: 'Window handle to search from (optional)' }
                },
                required: [] // At least one of automationId, name, className
            }
        },
        {
            name: 'ui.type_into_element',
            description: 'Type text into a UI element (set value or simulate typing).',
            parameters: {
                type: 'object',
                properties: {
                    automationId: { type: 'string', description: 'Automation ID of the element' },
                    name: { type: 'string', description: 'Name of the element' },
                    className: { type: 'string', description: 'Class name of the element' },
                    text: { type: 'string', description: 'Text to type' },
                    rootHandle: { type: 'number', description: 'Window handle to search from (optional)' }
                },
                required: ['text'] // At least one identifier and text
            }
        }
    ],
    async execute(toolName, args) {
        log.debug({ toolName, args }, 'Executing');
        switch (toolName) {
            case 'ui.list_elements': return handleUIListElements(args);
            case 'ui.get_element': return handleUIGetElement(args);
            case 'ui.click_element': return handleUIClickElement(args);
            case 'ui.type_into_element': return handleUITypeIntoElement(args);
            default:
                throw new errors_1.ExecutionError('ui_inspector', `Unknown tool: ${toolName}`);
        }
    }
};
// Self-register
registry_1.registry.register(uiInspector);
exports.default = uiInspector;
//# sourceMappingURL=ui_inspector.js.map