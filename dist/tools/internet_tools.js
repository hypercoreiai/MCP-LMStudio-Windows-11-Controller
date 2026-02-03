"use strict";
/**
 * tools/internet_tools.ts
 *
 * Convenience internet tools that open Firefox for fetch/search.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("../core/types");
const registry_1 = require("../core/registry");
const errors_1 = require("../core/errors");
const logger_1 = require("../core/logger");
const child_process_1 = require("child_process");
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const log = (0, logger_1.scopedLogger)('tools/internet_tools');
function toUrlFromDomain(domain) {
    const trimmed = domain.trim();
    if (/^https?:\/\//i.test(trimmed))
        return trimmed;
    return `https://${trimmed}`;
}
function toGoogleSearchUrl(terms) {
    const query = encodeURIComponent(terms.trim());
    return `https://www.google.com/search?q=${query}`;
}
function ensureUrl(value) {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed))
        return trimmed;
    return `https://${trimmed}`;
}
function isValidUrl(value) {
    try {
        // eslint-disable-next-line no-new
        new URL(value);
        return true;
    }
    catch {
        return false;
    }
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function ps(script, timeoutMs = 30000) {
    try {
        const buffer = Buffer.from(script, 'utf16le');
        const encoded = buffer.toString('base64');
        return (0, child_process_1.execSync)(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, { encoding: 'utf-8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    }
    catch (e) {
        throw new errors_1.ExecutionError('internet_tools', e.stderr?.toString() || e.message);
    }
}
function cleanAndFormatAsMarkdown(rawText, url, scrollPercent) {
    // Split into lines and clean each one
    const lines = rawText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    // Remove duplicate consecutive lines
    const deduplicated = [];
    let lastLine = '';
    for (const line of lines) {
        if (line !== lastLine) {
            deduplicated.push(line);
            lastLine = line;
        }
    }
    // Group lines into logical sections and add markdown formatting
    const sections = [];
    let currentSection = [];
    for (const line of deduplicated) {
        // Treat lines that end with common heading patterns as headers
        if (line.length < 100 &&
            (line.endsWith(':') ||
                line.match(/^(Home|About|Contact|Features|Help|Settings|Menu|Dashboard)$/i) ||
                line.match(/^[A-Z][A-Za-z\s]{2,50}$/))) {
            if (currentSection.length > 0) {
                sections.push(currentSection.join('\n'));
                currentSection = [];
            }
            sections.push(`## ${line.replace(/:$/, '')}`);
        }
        else {
            currentSection.push(line);
        }
    }
    if (currentSection.length > 0) {
        sections.push(currentSection.join('\n'));
    }
    const headerStatus = scrollPercent <= 0 ? '⬆️ Reached top' : '⬆️ Scroll up to see more';
    const footerStatus = scrollPercent >= 100 ? '⬇️ Reached bottom' : '⬇️ Scroll down to see more';
    const markdown = `# Page Content

**URL:** ${url}
**Scroll Position:** ${scrollPercent}%

---

${headerStatus}

---

${sections.join('\n\n')}

---

${footerStatus}`;
    return markdown;
}
async function fetchHtml(url, maxBytes = 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const client = target.protocol === 'https:' ? https : http;
        const req = client.get(target, res => {
            const status = res.statusCode ?? 0;
            const contentType = res.headers['content-type'];
            const chunks = [];
            let bytes = 0;
            res.on('data', (chunk) => {
                bytes += chunk.length;
                if (bytes > maxBytes) {
                    req.destroy(new Error(`Response exceeded ${maxBytes} bytes`));
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                resolve({ status, contentType: Array.isArray(contentType) ? contentType[0] : contentType, html: Buffer.concat(chunks).toString('utf-8') });
            });
        });
        req.on('error', err => reject(err));
    });
}
async function callProcessStart(url) {
    const invocation = {
        tool: 'process.start',
        args: {
            executable: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
            arguments: ['--remote-debugging-port=9222', url]
        },
        meta: {
            rawOutput: '',
            parserUsed: 'text',
            timestamp: Date.now(),
            correlationId: (0, types_1.generateCorrelationId)()
        }
    };
    return registry_1.registry.invoke(invocation);
}
async function handleInternetFetch(args) {
    const domain = args.domain;
    if (!domain) {
        return {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'domain is required' },
            durationMs: 0
        };
    }
    const url = toUrlFromDomain(domain);
    log.info({ url }, 'Launching Firefox for fetch');
    return callProcessStart(url);
}
async function handleInternetSearch(args) {
    const terms = args.terms;
    if (!terms) {
        return {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'terms is required' },
            durationMs: 0
        };
    }
    const url = toGoogleSearchUrl(terms);
    log.info({ url }, 'Launching Firefox for search');
    return callProcessStart(url);
}
async function handleInternetScrape(_args) {
    const fallbackUrl = _args.fallbackUrl;
    // 1) Capture current clipboard
    const originalClipboard = await registry_1.registry.invoke({
        tool: 'clipboard.get',
        args: {},
        meta: { rawOutput: '', parserUsed: 'text', timestamp: Date.now(), correlationId: (0, types_1.generateCorrelationId)() }
    });
    const attemptCopyUrl = async () => {
        await registry_1.registry.invoke({
            tool: 'input.hotkey',
            args: { combo: 'Ctrl+L' },
            meta: { rawOutput: '', parserUsed: 'text', timestamp: Date.now(), correlationId: (0, types_1.generateCorrelationId)() }
        });
        await sleep(150);
        await registry_1.registry.invoke({
            tool: 'input.hotkey',
            args: { combo: 'Ctrl+C' },
            meta: { rawOutput: '', parserUsed: 'text', timestamp: Date.now(), correlationId: (0, types_1.generateCorrelationId)() }
        });
        await sleep(150);
        const clipboardAfter = await registry_1.registry.invoke({
            tool: 'clipboard.get',
            args: {},
            meta: { rawOutput: '', parserUsed: 'text', timestamp: Date.now(), correlationId: (0, types_1.generateCorrelationId)() }
        });
        return clipboardAfter.data?.content ?? clipboardAfter?.data?.text ?? '';
    };
    try {
        // 2) Try to copy URL from address bar (requires Firefox focus)
        let urlText = await attemptCopyUrl();
        // Retry once if not valid
        let candidate = typeof urlText === 'string' ? urlText.trim() : '';
        if (candidate) {
            candidate = ensureUrl(candidate);
        }
        if (!candidate || !isValidUrl(candidate)) {
            urlText = await attemptCopyUrl();
            candidate = typeof urlText === 'string' ? urlText.trim() : '';
            if (candidate) {
                candidate = ensureUrl(candidate);
            }
        }
        if ((!candidate || !isValidUrl(candidate)) && fallbackUrl) {
            const fallbackCandidate = ensureUrl(fallbackUrl);
            if (isValidUrl(fallbackCandidate)) {
                candidate = fallbackCandidate;
            }
        }
        if (!candidate || !isValidUrl(candidate)) {
            return {
                success: false,
                error: { code: 'EXECUTION_ERROR', message: `Invalid URL in address bar: "${urlText}". Ensure Firefox is focused or provide fallbackUrl.` },
                durationMs: 0
            };
        }
        log.info({ url: candidate }, 'Fetching HTML from focused Firefox URL');
        const { status, contentType, html } = await fetchHtml(candidate);
        return {
            success: true,
            data: { url: candidate, status, contentType, html },
            durationMs: 0
        };
    }
    catch (e) {
        return {
            success: false,
            error: { code: 'EXECUTION_ERROR', message: e.message },
            durationMs: 0
        };
    }
    finally {
        // Restore clipboard (best-effort)
        const originalText = originalClipboard.data?.content ?? originalClipboard?.data?.text;
        if (typeof originalText === 'string') {
            await registry_1.registry.invoke({
                tool: 'clipboard.set',
                args: { content: originalText },
                meta: { rawOutput: '', parserUsed: 'text', timestamp: Date.now(), correlationId: (0, types_1.generateCorrelationId)() }
            });
        }
    }
}
async function handleInternetScrapeVisual(args) {
    const url = args.url;
    if (!url) {
        throw new errors_1.ExecutionError('internet_tools', 'URL is required for visual scraping');
    }
    try {
        // Use Windows UI Automation to read the accessibility tree (visible content)
        const script = `
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes

      $automation = [System.Windows.Automation.AutomationElement]::RootElement
      $firefoxWindow = $automation.FindFirst(
        [System.Windows.Automation.TreeScope]::Children,
        (New-Object System.Windows.Automation.PropertyCondition(
          [System.Windows.Automation.AutomationElement]::ClassNameProperty,
          'MozillaWindowClass'
        ))
      )

      if (-not $firefoxWindow) {
        Write-Output 'ERROR:Firefox window not found'
        exit
      }

      # Get scroll position (if available)
      $scrollPattern = $null
      try {
        $scrollPattern = $firefoxWindow.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
      } catch {}

      $verticalScroll = 0
      if ($scrollPattern) {
        $verticalScroll = [int]$scrollPattern.Current.VerticalScrollPercent
      }

      # Recursively extract text from all visible text elements
      function Get-TextContent {
        param($element, [int]$depth = 0)

        if ($depth -gt 20) { return @() }  # Prevent infinite recursion

        $texts = @()

        try {
          $name = $element.Current.Name
          $controlType = $element.Current.ControlType.ProgrammaticName

          # Collect text from text-containing controls
          if ($name -and $name.Trim() -ne '' -
              ($controlType -match 'Text|Button|Link|MenuItem|Header|ListItem|DataItem')) {
            $texts += $name.Trim()
          }

          # Recurse into children
          $walker = [System.Windows.Automation.TreeWalker]::ContentViewWalker
          $child = $walker.GetFirstChild($element)

          while ($child) {
            $texts += Get-TextContent $child ($depth + 1)
            $child = $walker.GetNextSibling($child)
          }
        } catch {
          # Skip elements that throw errors
        }

        return $texts
      }

      $allText = Get-TextContent $firefoxWindow

      # Output result
      Write-Output "SCROLL_PERCENT:$verticalScroll"
      Write-Output 'CONTENT_START'
      $allText | ForEach-Object { Write-Output $_ }
      Write-Output 'CONTENT_END'
    `;
        const rawOutput = ps(script);
        // Parse the output
        const lines = rawOutput.split('\n').map(l => l.trim()).filter(l => l);
        let scrollPercent = 0;
        let contentLines = [];
        let inContent = false;
        for (const line of lines) {
            if (line.startsWith('ERROR:')) {
                throw new errors_1.ExecutionError('internet_tools', line.substring(6));
            }
            if (line.startsWith('SCROLL_PERCENT:')) {
                scrollPercent = parseInt(line.substring(15), 10) || 0;
            }
            else if (line === 'CONTENT_START') {
                inContent = true;
            }
            else if (line === 'CONTENT_END') {
                inContent = false;
            }
            else if (inContent) {
                contentLines.push(line);
            }
        }
        const content = contentLines.join('\n');
        // Format as clean markdown
        const markdown = cleanAndFormatAsMarkdown(content, url, scrollPercent);
        return {
            success: true,
            data: { url, scrollPercent, markdown },
            durationMs: 0
        };
    }
    catch (e) {
        return {
            success: false,
            error: { code: 'EXECUTION_ERROR', message: e.message },
            durationMs: 0
        };
    }
}
async function handleInternetFetchAndScrape(args) {
    const domain = args.domain;
    if (!domain) {
        throw new errors_1.ExecutionError('internet_tools', 'Domain is required');
    }
    const url = toUrlFromDomain(domain);
    // Step 1: Fetch (open Firefox to URL)
    const fetchResult = await handleInternetFetch({ domain });
    if (!fetchResult.success) {
        return fetchResult;
    }
    // Wait for page to load
    await sleep(3000);
    // Step 2: Focus the Firefox window
    const pid = fetchResult.data?.pid;
    if (pid) {
        await registry_1.registry.invoke({
            tool: 'window.focus',
            args: { pid },
            meta: { rawOutput: '', parserUsed: 'text', timestamp: Date.now(), correlationId: (0, types_1.generateCorrelationId)() }
        });
        await sleep(1000); // Wait for focus
    }
    // Step 3: Scrape visual content
    const scrapeResult = await handleInternetScrapeVisual({ url });
    return {
        success: scrapeResult.success,
        data: {
            ...scrapeResult.data,
            fetchedUrl: url,
            pid: pid
        },
        error: scrapeResult.error,
        durationMs: 0
    };
}
const internetTools = {
    name: 'internet_tools',
    tools: [
        {
            name: 'internet.fetch',
            description: 'Open Firefox to a given domain or URL.',
            parameters: {
                type: 'object',
                properties: {
                    domain: { type: 'string', description: 'Domain or full URL to open (e.g. "example.com" or "https://example.com")' }
                },
                required: ['domain']
            }
        },
        {
            name: 'internet.search',
            description: 'Open Firefox with a Google search for the provided terms.',
            parameters: {
                type: 'object',
                properties: {
                    terms: { type: 'string', description: 'Search terms to query on Google' }
                },
                required: ['terms']
            }
        },
        {
            name: 'internet.scrape',
            description: 'Scrape the current page by copying the URL from the focused Firefox window and fetching HTML.',
            parameters: {
                type: 'object',
                properties: {
                    fallbackUrl: { type: 'string', description: 'Optional URL to use if the address bar copy is invalid.' }
                }
            }
        },
        {
            name: 'internet.scrape.visual',
            description: 'Scrape visual content from the focused Firefox window using Windows UI Automation. Reads what is actually rendered on screen (accessibility tree), not raw HTML. Returns clean text content suitable for analysis.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'The URL of the page being scraped (required for reliable operation)' }
                },
                required: ['url']
            }
        },
        {
            name: 'internet.fetch.and.scrape',
            description: 'Open Firefox to a URL, focus the window, and scrape visual content in one operation.',
            parameters: {
                type: 'object',
                properties: {
                    domain: { type: 'string', description: 'Domain name or full URL to open and scrape' }
                },
                required: ['domain']
            }
        }
    ],
    async execute(toolName, args) {
        switch (toolName) {
            case 'internet.fetch':
                return handleInternetFetch(args);
            case 'internet.search':
                return handleInternetSearch(args);
            case 'internet.scrape':
                return handleInternetScrape(args);
            case 'internet.scrape.visual':
                return handleInternetScrapeVisual(args);
            case 'internet.fetch.and.scrape':
                return handleInternetFetchAndScrape(args);
            default:
                throw new errors_1.ExecutionError('internet_tools', `Unknown tool: ${toolName}`);
        }
    }
};
registry_1.registry.register(internetTools);
exports.default = internetTools;
//# sourceMappingURL=internet_tools.js.map