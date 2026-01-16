# Figma Import Test Instructions

## Test Job Ready

**Job ID:** `85813362-a324-4d94-84df-d4b701b690cd`
**Queued At:** 2026-01-10T15:24:18.626Z
**Payload Size:** 53.4 KB
**Source URL:** https://example.com
**Status:** Queued and ready for import

---

## Prerequisites

✅ **Handoff server running:** http://localhost:4411
✅ **Figma plugin built:** `figma-plugin/dist/code.js` exists
✅ **Job in queue:** 1 job ready (verified)

---

## Steps to Test Figma Import

### 1. Open Figma Desktop

Launch Figma Desktop application (not web version - plugins require desktop app).

### 2. Load the Plugin

**Option A: If plugin already imported:**
- Go to **Plugins** → **Development** → **Web to Figma Capture**

**Option B: First time setup:**
1. Go to **Plugins** → **Development** → **Import plugin from manifest**
2. Navigate to `/Users/skirk92/figmacionvert-2/figma-plugin/manifest.json`
3. Click **Open**
4. Plugin should appear in Development plugins list

### 3. Run the Plugin

1. Create a new Figma file or open existing one
2. Right-click on canvas → **Plugins** → **Development** → **Web to Figma Capture**
3. Plugin window should open

### 4. Expected Behavior

**Auto-import mode is enabled by default:**

The plugin polls `http://localhost:4411/api/jobs/next` every 3 seconds. When it detects the job, it should:

1. **Display job info:**
   - Job ID: `85813362-a324-4d94-84df-d4b701b690cd`
   - URL: `https://example.com`
   - Import started automatically

2. **Import progress:**
   - Loading fonts (Inter family)
   - Building Figma nodes
   - Creating frames
   - Applying styles

3. **Import complete:**
   - New page created in Figma: "Web Import - [timestamp]"
   - Main frame with captured content
   - Status: "Import complete!"

### 5. Verify Import Results

**Check the imported content:**

- **Page structure:**
  - New page should appear in layers panel
  - Root frame named after the URL

- **Content accuracy:**
  - Text nodes with proper fonts
  - Rectangles with fills and strokes
  - Correct layout and positioning

- **Screenshot (if included):**
  - Reference screenshot should be visible
  - Compare visual fidelity

### 6. Server Logs

Monitor server logs for confirmation:

```bash
tail -f /Users/skirk92/figmacionvert-2/mcp-gemini-cli/server.log
```

**Expected log output:**
```
📤 Delivering job: 85813362-a324-4d94-84df-d4b701b690cd
✅ Job completed: 85813362-a324-4d94-84df-d4b701b690cd
📸 Saved Figma screenshot: [path]
```

---

## Troubleshooting

### Plugin doesn't auto-import

**Check server connection:**
```bash
curl http://localhost:4411/api/health
# Should return: {"ok": true, "queueLength": 1}
```

**Check plugin console:**
- Open Figma Desktop
- Go to **Plugins** → **Development** → **Open Console**
- Look for errors or connection issues

### Import fails or errors

**Check job payload:**
```bash
curl -s 'http://localhost:4411/api/jobs/recent?limit=1' | jq '.jobs[0]'
```

**Verify job status:**
- `status: "queued"` = ready for import
- `status: "processing"` = currently being imported
- `status: "completed"` = import finished

### No job in queue

If you accidentally consumed the job, create a new one:

```bash
cd /Users/skirk92/figmacionvert-2
node tools/capture-runner.js https://example.com
```

Wait for "🎉 SUCCESS" message, then retry Figma import.

---

## Manual Import Mode

If auto-import doesn't work, try manual mode:

1. Open plugin UI
2. Disable auto-import toggle (if available)
3. Click "Fetch Next Job" button manually
4. Job should import immediately

---

## Verification Checklist

- [ ] Plugin loaded successfully in Figma
- [ ] Server connection confirmed (green LED/status)
- [ ] Job detected by plugin
- [ ] Import started automatically
- [ ] Import completed without errors
- [ ] New page created in Figma
- [ ] Content matches example.com structure
- [ ] Server logs show job delivery and completion

---

## Additional Notes

**DevTools removed:** The `devtools: false` flag is now set in capture-runner.js, so Chrome DevTools won't open automatically during future tests.

**Payload persistence:** Job payloads are stored in memory only. If the server restarts, you'll need to create a fresh capture.

**Queue order:** Jobs are delivered FIFO (first in, first out). If multiple jobs exist, the oldest queued job is delivered first.

---

## Next Steps After Successful Test

1. Test with more complex pages (e.g., https://google.com)
2. Verify screenshot comparison functionality
3. Test component detection and variants
4. Validate design system generation
5. Compare Figma output against original webpage
