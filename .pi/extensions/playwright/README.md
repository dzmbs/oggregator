# Playwright Extension

Automated browser testing for localhost performance benchmarking.

## Setup

1. **Install dependencies**:
   ```bash
   cd .pi/extensions/playwright
   npm install
   npx playwright install chromium
   ```

2. **Reload pi** (auto-loads from `.pi/extensions/`):
   ```bash
   /reload
   ```

   You should see: `🎭 Playwright extension loaded`

## Available Tools

Claude now has these tools for browser automation:

| Tool | Description |
|------|-------------|
| `playwright_launch` | Launch browser (call first) |
| `playwright_navigate` | Navigate to URL + measure load time |
| `playwright_click` | Click element by CSS selector |
| `playwright_wait` | Wait for element to appear |
| `playwright_evaluate` | Run JavaScript (get console logs, metrics) |
| `playwright_get_console` | Capture console output |
| `playwright_screenshot` | Take screenshot |
| `playwright_close` | Close browser |

## Quick Start

**Prerequisites**: Ensure backend (port 8000) and frontend (port 3000) are running.

**Example prompt** (copy-paste to Claude):

> Test performance: Launch browser, navigate to localhost:3000, click map view, wait for it to load, capture all console logs with 'PERF' in them, extract timing data, then close browser.

Claude will:
1. `playwright_launch({ headless: false })` - Start visible browser
2. `playwright_navigate({ url: "http://localhost:3000" })` - Load page
3. `playwright_click({ selector: "[data-view='map']" })` - Switch to map
4. `playwright_wait({ selector: ".map-loaded" })` - Wait for render
5. `playwright_get_console({ filter: "PERF" })` - Extract metrics
6. `playwright_close()` - Clean up

## Performance Metrics

### Get Console Logs with Timing

```javascript
// Use playwright_evaluate
const logs = await page.evaluate(() => {
  return window.console.logs.filter(l => l.includes('[PERF]'));
});
```

### Navigation Timing

```javascript
// Use playwright_evaluate
const timing = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  return {
    domReady: nav.domContentLoadedEventEnd,
    fullLoad: nav.loadEventEnd,
    responseTime: nav.responseEnd
  };
});
```

## Testing Workflow

### Compare OLD vs NEW approach

1. **Test baseline**:
   ```bash
   git checkout 09df5a9  # OLD approach
   # Restart frontend
   # Ask Claude to run test and save results
   ```

2. **Test optimized**:
   ```bash
   git checkout dev
   # Restart frontend
   # Ask Claude to run same test
   ```

3. **Ask Claude**: "Compare both result sets and calculate improvement"

### Example Test Prompt

> I need you to test the performance of the map view on localhost:3000:
>
> 1. Launch browser (headless: false so I can watch)
> 2. Navigate to http://localhost:3000
> 3. Click the map view icon (selector: `[data-view="map"]`)
> 4. Wait for the map to fully load
> 5. Capture console logs with `[PERF]` markers
> 6. Extract these metrics:
>    - "Map points fetch: XXms"
>    - "Sidebar sync: XXms"
>    - "Switch to map: XXms"
> 7. Pan the map (run JavaScript to trigger pan)
> 8. Capture sidebar sync time after pan
> 9. Close browser
> 10. Present results in a table

Expected output:

```
📊 Performance Test Results

Initial Load:
- Map points fetch: 1,549ms
- Switch to map: 35ms
- Sidebar sync (first): 2.6ms

After Pan (cached):
- Sidebar sync: 0.9ms
```

## Debugging

### Headless vs Visible

```javascript
// See browser window during test
playwright_launch({ headless: false })

// Run in background (faster)
playwright_launch({ headless: true })
```

### Screenshots

Ask Claude: "Take a screenshot after each major step"

### Console Errors

All browser `console.error` and `console.warn` output appears in pi terminal automatically.

### Selector Issues

If clicks fail:
1. Ask Claude: `playwright_screenshot` to see current state
2. Ask Claude: `playwright_evaluate` with `document.querySelector('[data-view="map"]')` to verify selector
3. Update selector and retry

## Cleanup

Browser auto-closes when:
- `playwright_close` is called
- Pi session ends
- Extension unloads

Manual close:
```
Ask Claude: "Close the browser"
```

## Advanced Usage

### Custom Console Logging

Inject logging hooks:

```javascript
playwright_evaluate({
  script: `
    window.perfLogs = [];
    const orig = console.log;
    console.log = (...args) => {
      window.perfLogs.push(args.join(' '));
      orig(...args);
    };
  `
})
```

Later retrieve:
```javascript
playwright_evaluate({
  script: `window.perfLogs.filter(l => l.includes('[PERF]'))`
})
```

### Network Timing

```javascript
playwright_evaluate({
  script: `
    performance.getEntriesByType('resource')
      .filter(r => r.name.includes('map-points'))
      .map(r => ({
        url: r.name,
        duration: r.duration,
        transferSize: r.transferSize
      }))
  `
})
```

## Architecture

This is a **pi extension package** that:
- Lives in `.pi/extensions/playwright/`
- Auto-loads when pi starts
- Registers custom tools via `pi.registerTool()`
- Uses Playwright Node.js API (not MCP server)

See `index.ts` for implementation details.
