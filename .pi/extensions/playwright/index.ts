/**
 * Playwright Performance Testing Extension for Pi
 * 
 * Gives Claude browser automation capabilities to:
 * - Navigate to localhost URLs
 * - Click elements, fill forms
 * - Capture performance metrics
 * - Take screenshots for verification
 * 
 * Install: npm install playwright
 * Usage: Ask Claude to test performance on localhost
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser | null = null;
let page: Page | null = null;

export default function (pi: ExtensionAPI) {
  // Notify on load
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("🎭 Playwright extension loaded - use playwright_* tools", "info");
  });

  // Clean up browser on session end
  pi.on("session_end", async () => {
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }
  });

  // Launch browser
  pi.registerTool({
    name: "playwright_launch",
    label: "Launch Browser",
    description: "Launch a Chromium browser instance for testing. Must be called before other playwright commands.",
    parameters: Type.Object({
      headless: Type.Optional(Type.Boolean({ description: "Run in headless mode (default: false for debugging)" })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        if (browser) {
          return { content: [{ type: "text", text: "Browser already running" }], details: {} };
        }

        browser = await chromium.launch({ 
          headless: params.headless ?? false,
          devtools: false,
        });
        page = await browser.newPage();

        // Enable console logging
        page.on('console', msg => {
          const type = msg.type();
          if (type === 'error' || type === 'warning') {
            console.log(`[Browser ${type}]`, msg.text());
          }
        });

        return {
          content: [{ type: "text", text: `✅ Browser launched (headless=${params.headless ?? false})` }],
          details: {},
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `❌ Failed to launch browser: ${error}` }],
          details: { error: String(error) },
        };
      }
    },
  });

  // Navigate
  pi.registerTool({
    name: "playwright_navigate",
    label: "Navigate",
    description: "Navigate to a URL. Returns page load timing.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to navigate to (e.g., http://localhost:3000)" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!page) {
        return { content: [{ type: "text", text: "❌ Browser not launched. Call playwright_launch first." }], details: {} };
      }

      try {
        const start = Date.now();
        const response = await page.goto(params.url, { waitUntil: "networkidle" });
        const loadTime = Date.now() - start;

        return {
          content: [{
            type: "text",
            text: `✅ Navigated to ${params.url}\n` +
                  `Load time: ${loadTime}ms\n` +
                  `Status: ${response?.status() || 'unknown'}`
          }],
          details: { loadTime, status: response?.status() },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `❌ Navigation failed: ${error}` }],
          details: { error: String(error) },
        };
      }
    },
  });

  // Click element
  pi.registerTool({
    name: "playwright_click",
    label: "Click",
    description: "Click an element by CSS selector",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector (e.g., 'button', '#map-icon', '.view-toggle')" }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in ms (default: 30000)" })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!page) {
        return { content: [{ type: "text", text: "❌ Browser not launched" }], details: {} };
      }

      try {
        await page.click(params.selector, { timeout: params.timeout ?? 30000 });
        return {
          content: [{ type: "text", text: `✅ Clicked: ${params.selector}` }],
          details: {},
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `❌ Click failed: ${error}` }],
          details: { error: String(error) },
        };
      }
    },
  });

  // Evaluate JavaScript (for performance metrics)
  pi.registerTool({
    name: "playwright_evaluate",
    label: "Evaluate JS",
    description: "Execute JavaScript in the page context. Use for reading console logs, performance metrics, etc.",
    parameters: Type.Object({
      script: Type.String({ description: "JavaScript code to execute" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!page) {
        return { content: [{ type: "text", text: "❌ Browser not launched" }], details: {} };
      }

      try {
        const result = await page.evaluate(params.script);
        return {
          content: [{
            type: "text",
            text: `✅ Evaluated:\n${JSON.stringify(result, null, 2)}`
          }],
          details: { result },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `❌ Evaluation failed: ${error}` }],
          details: { error: String(error) },
        };
      }
    },
  });

  // Get console logs
  pi.registerTool({
    name: "playwright_get_console",
    label: "Get Console",
    description: "Get recent console logs from the page (performance logs, errors, etc.)",
    parameters: Type.Object({
      filter: Type.Optional(Type.String({ description: "Filter logs by text (e.g., 'PERF', 'error')" })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!page) {
        return { content: [{ type: "text", text: "❌ Browser not launched" }], details: {} };
      }

      try {
        // Capture console messages
        const logs: string[] = [];
        const listener = (msg: any) => {
          const text = msg.text();
          if (!params.filter || text.includes(params.filter)) {
            logs.push(`[${msg.type()}] ${text}`);
          }
        };

        page.on('console', listener);
        
        // Wait a bit for logs to accumulate
        await new Promise(resolve => setTimeout(resolve, 100));
        
        page.off('console', listener);

        return {
          content: [{
            type: "text",
            text: logs.length > 0 
              ? `Console logs:\n${logs.join('\n')}`
              : "No console logs captured"
          }],
          details: { logs },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `❌ Failed to get console: ${error}` }],
          details: { error: String(error) },
        };
      }
    },
  });

  // Screenshot
  pi.registerTool({
    name: "playwright_screenshot",
    label: "Screenshot",
    description: "Take a screenshot of the current page",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Save path (default: ./screenshot.png)" })),
      fullPage: Type.Optional(Type.Boolean({ description: "Capture full scrollable page (default: false)" })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!page) {
        return { content: [{ type: "text", text: "❌ Browser not launched" }], details: {} };
      }

      try {
        const path = params.path ?? './screenshot.png';
        await page.screenshot({ path, fullPage: params.fullPage ?? false });
        return {
          content: [{ type: "text", text: `✅ Screenshot saved: ${path}` }],
          details: { path },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `❌ Screenshot failed: ${error}` }],
          details: { error: String(error) },
        };
      }
    },
  });

  // Wait for selector
  pi.registerTool({
    name: "playwright_wait",
    label: "Wait",
    description: "Wait for an element to appear on the page",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector to wait for" }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in ms (default: 30000)" })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!page) {
        return { content: [{ type: "text", text: "❌ Browser not launched" }], details: {} };
      }

      try {
        const start = Date.now();
        await page.waitForSelector(params.selector, { timeout: params.timeout ?? 30000 });
        const waitTime = Date.now() - start;
        
        return {
          content: [{ type: "text", text: `✅ Element appeared: ${params.selector} (after ${waitTime}ms)` }],
          details: { waitTime },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `❌ Wait failed: ${error}` }],
          details: { error: String(error) },
        };
      }
    },
  });

  // Close browser
  pi.registerTool({
    name: "playwright_close",
    label: "Close Browser",
    description: "Close the browser instance",
    parameters: Type.Object({}),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        if (browser) {
          await browser.close();
          browser = null;
          page = null;
          return { content: [{ type: "text", text: "✅ Browser closed" }], details: {} };
        }
        return { content: [{ type: "text", text: "Browser was not running" }], details: {} };
      } catch (error) {
        return {
          content: [{ type: "text", text: `❌ Failed to close browser: ${error}` }],
          details: { error: String(error) },
        };
      }
    },
  });
}
