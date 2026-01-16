/**
 * Handoff Server - Coordinates data transfer between Extension/Puppeteer and Figma Plugin
 * Includes screenshot upload support for visual validation feedback loop
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 4411;
const HOST = process.env.HOST || '0.0.0.0';

// Increase payload limit for large schemas with screenshots
app.use(express.json({ limit: '100mb' }));
app.use(express.raw({ type: 'image/png', limit: '50mb' }));
app.use(express.raw({ type: 'application/gzip', limit: '100mb' }));
app.use(cors());

// In-memory job queue and state
const jobs = [];
const jobsFile = path.join(__dirname, 'handoff-jobs.json');
const artifactsDir = path.join(__dirname, 'artifacts', 'handoff');

// Ensure artifacts directory exists
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

// Telemetry tracking
const telemetry = {
  lastExtensionPingAt: null,
  lastExtensionTransferAt: null,
  lastPluginPollAt: null,
  lastPluginDeliveryAt: null,
  lastQueuedJobId: null,
  lastDeliveredJobId: null,
  queueLength: 0
};

const serverStartTime = Date.now();

// Load existing jobs on startup
function loadJobs() {
  try {
    if (fs.existsSync(jobsFile)) {
      const data = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
      if (data.jobs && Array.isArray(data.jobs)) {
        jobs.push(...data.jobs);
        console.log(`📂 Loaded ${jobs.length} existing jobs from disk`);
      }
      if (data.telemetry) {
        Object.assign(telemetry, data.telemetry);
      }
    }
  } catch (error) {
    console.error('⚠️ Failed to load jobs:', error.message);
  }
}

// Save jobs to disk
function saveJobs() {
  try {
    const data = {
      jobs: jobs.map(j => ({
        id: j.id,
        queuedAt: j.queuedAt,
        deliveredAt: j.deliveredAt,
        completedAt: j.completedAt,
        hasPayload: !!j.payload,
        payloadSize: j.payload ? JSON.stringify(j.payload).length : 0,
        hasFigmaScreenshot: !!j.figmaScreenshot,
        status: j.status || 'pending'
      })),
      telemetry: {
        ...telemetry,
        queueLength: jobs.filter(j => !j.deliveredAt).length
      },
      lastDeliveredJob: jobs.find(j => j.id === telemetry.lastDeliveredJobId)
        ? {
            id: telemetry.lastDeliveredJobId,
            deliveredAt: telemetry.lastPluginDeliveryAt,
            hasPayload: !!jobs.find(j => j.id === telemetry.lastDeliveredJobId)?.payload
          }
        : null
    };
    fs.writeFileSync(jobsFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('⚠️ Failed to save jobs:', error.message);
  }
}

// Initialize
loadJobs();

/**
 * POST /api/jobs - Queue a new capture job from extension/Puppeteer
 */
app.post('/api/jobs', (req, res) => {
  const jobId = uuidv4();
  const job = {
    id: jobId,
    payload: req.body,
    queuedAt: Date.now(),
    deliveredAt: null,
    completedAt: null,
    figmaScreenshot: null,
    status: 'queued'
  };

  jobs.push(job);
  telemetry.lastExtensionTransferAt = Date.now();
  telemetry.lastQueuedJobId = jobId;
  telemetry.queueLength = jobs.filter(j => !j.deliveredAt).length;

  saveJobs();

  const jobSizeKB = (JSON.stringify(req.body).length / 1024).toFixed(1);
  const sourceURL = req.body?.metadata?.url || 'unknown';

  console.log(`✅ Job queued: ${jobId} (${jobSizeKB} KB)`);
  console.log(`[SERVER][JOB_QUEUED] jobId=${jobId} bytes=${req.body ? JSON.stringify(req.body).length : 0} url=${sourceURL}`);

  // Save original screenshot for debug-runner comparison
  if (req.body && req.body.screenshot) {
    const jobDir = path.join(artifactsDir, 'debug', jobId);
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }
    
    let imageData = req.body.screenshot;
    if (imageData.startsWith('data:image')) {
      imageData = imageData.split(',')[1];
    }
    
    const originalPath = path.join(jobDir, 'original_capture.png');
    fs.writeFileSync(originalPath, Buffer.from(imageData, 'base64'));
    console.log(`📸 Saved original capture to: ${originalPath}`);
  }

  res.json({
    success: true,
    id: jobId,
    queuePosition: jobs.filter(j => !j.deliveredAt).length
  });
});

/**
 * GET /api/jobs/next - Poll for next job (used by Figma plugin)
 */
app.get('/api/jobs/next', (req, res) => {
  telemetry.lastPluginPollAt = Date.now();

  const nextJob = jobs.find(j => !j.deliveredAt);

  if (nextJob) {
    nextJob.deliveredAt = Date.now();
    nextJob.status = 'processing';
    telemetry.lastPluginDeliveryAt = nextJob.deliveredAt;
    telemetry.lastDeliveredJobId = nextJob.id;
    telemetry.queueLength = jobs.filter(j => !j.deliveredAt).length;

    saveJobs();

    console.log(`📤 Delivering job: ${nextJob.id}`);

    res.json({
      job: {
        id: nextJob.id,
        payload: nextJob.payload,
        queuedAt: nextJob.queuedAt
      },
      telemetry: {
        ...telemetry,
        queueLength: jobs.filter(j => !j.deliveredAt).length
      }
    });
  } else {
    res.json({ 
      job: null,
      telemetry: {
        ...telemetry,
        queueLength: jobs.filter(j => !j.deliveredAt).length
      }
    });
  }
});

/**
 * GET /api/jobs/recent - Get recent jobs without dequeueing (for verification)
 * Query params:
 *   - limit: number of jobs to return (default 10, max 100)
 *   - includePayload: whether to include full payload (default false)
 */
app.get('/api/jobs/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 100);
  const includePayload = req.query.includePayload === 'true';

  // Return most recent jobs first (reverse chronological)
  const recentJobs = jobs
    .slice(-limit)
    .reverse()
    .map(j => ({
      id: j.id,
      queuedAt: j.queuedAt,
      deliveredAt: j.deliveredAt,
      completedAt: j.completedAt,
      status: j.status || 'pending',
      hasPayload: !!j.payload,
      payloadSize: j.payload ? JSON.stringify(j.payload).length : 0,
      hasFigmaScreenshot: !!j.figmaScreenshot,
      ...(includePayload && j.payload ? { payload: j.payload } : {})
    }));

  res.json({
    jobs: recentJobs,
    total: jobs.length,
    pending: jobs.filter(j => !j.deliveredAt).length
  });
});

/**
 * POST /api/jobs/:jobId/complete - Mark job complete and upload Figma screenshot
 */
app.post('/api/jobs/:jobId/complete', express.raw({ type: 'image/png', limit: '50mb' }), (req, res) => {
  const { jobId } = req.params;
  const job = jobs.find(j => j.id === jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Save Figma screenshot if provided
  if (req.body && Buffer.isBuffer(req.body)) {
    const screenshotPath = path.join(artifactsDir, `${jobId}-figma.png`);
    fs.writeFileSync(screenshotPath, req.body);
    job.figmaScreenshot = screenshotPath;
    console.log(`📸 Saved Figma screenshot: ${screenshotPath} (${(req.body.length / 1024).toFixed(1)} KB)`);
  }

  job.completedAt = Date.now();
  job.status = 'completed';

  saveJobs();

  console.log(`✅ Job completed: ${jobId}`);

  res.json({ success: true });
});

/**
 * POST /api/jobs/:jobId/screenshot - Upload Figma screenshot (alternative endpoint with JSON wrapper)
 */
app.post('/api/jobs/:jobId/screenshot', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.find(j => j.id === jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const { screenshot } = req.body;
  if (screenshot) {
    const screenshotPath = path.join(artifactsDir, `${jobId}-figma.png`);

    // Handle base64 data URL
    let imageData = screenshot;
    if (screenshot.startsWith('data:image')) {
      imageData = screenshot.split(',')[1];
    }

    fs.writeFileSync(screenshotPath, Buffer.from(imageData, 'base64'));
    job.figmaScreenshot = screenshotPath;
    job.status = 'completed';
    job.completedAt = Date.now();

    saveJobs();

    console.log(`📸 Saved Figma screenshot: ${screenshotPath}`);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'No screenshot provided' });
  }
});

/**
 * GET /api/jobs/:jobId - Get job details and status
 */
app.get('/api/jobs/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.find(j => j.id === jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    id: job.id,
    status: job.status,
    queuedAt: job.queuedAt,
    deliveredAt: job.deliveredAt,
    completedAt: job.completedAt,
    hasFigmaScreenshot: !!job.figmaScreenshot,
    figmaScreenshotPath: job.figmaScreenshot
  });
});

/**
 * GET /api/jobs/:jobId/screenshot - Download Figma screenshot
 */
app.get('/api/jobs/:jobId/screenshot', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.find(j => j.id === jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (!job.figmaScreenshot || !fs.existsSync(job.figmaScreenshot)) {
    return res.status(404).json({ error: 'Screenshot not available' });
  }

  res.sendFile(job.figmaScreenshot);
});

/**
 * POST /api/debug/:jobId/import_render.png - Upload Figma render for visual diff
 */
app.post('/api/debug/:jobId/import_render.png', express.raw({ type: 'image/png', limit: '50mb' }), (req, res) => {
  const { jobId } = req.params;
  const job = jobs.find(j => j.id === jobId);

  if (!job) {
    console.warn(`⚠️ Debug upload for unknown job: ${jobId}`);
  }

  // Save render even if job not found (might be from a different session)
  const debugDir = path.join(artifactsDir, 'debug', jobId);
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const renderPath = path.join(debugDir, 'import_render.png');
  fs.writeFileSync(renderPath, req.body);

  if (job) {
    job.figmaScreenshot = renderPath;
    job.completedAt = Date.now();
    job.status = 'completed';
    saveJobs();
  }

  console.log(`📸 Saved Figma render: ${renderPath} (${(req.body.length / 1024).toFixed(1)} KB)`);
  res.json({ success: true });
});

/**
 * POST /api/debug/:jobId/import_report.json - Upload import report
 */
app.post('/api/debug/:jobId/import_report.json', (req, res) => {
  const { jobId } = req.params;
  const debugDir = path.join(artifactsDir, 'debug', jobId);

  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const reportPath = path.join(debugDir, 'import_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(req.body, null, 2));

  console.log(`📄 Saved import report: ${reportPath}`);
  res.json({ success: true });
});

/**
 * POST /api/debug/:jobId/figma_nodes.json - Upload full Figma node tree (JSON_REST_V1)
 */
app.post('/api/debug/:jobId/figma_nodes.json', (req, res) => {
  const { jobId } = req.params;
  const debugDir = path.join(artifactsDir, 'debug', jobId);

  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const nodesPath = path.join(debugDir, 'figma_nodes.json');
  fs.writeFileSync(nodesPath, JSON.stringify(req.body, null, 2));

  console.log(`🌳 Saved Figma nodes tree: ${nodesPath}`);
  res.json({ success: true });
});

/**
 * POST /api/debug/:jobId/figma_nodes.json.gz - Upload compressed Figma node tree
 */
app.post('/api/debug/:jobId/figma_nodes.json.gz', express.raw({ type: 'application/gzip', limit: '100mb' }), (req, res) => {
  const { jobId } = req.params;
  const debugDir = path.join(artifactsDir, 'debug', jobId);

  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const gzPath = path.join(debugDir, 'figma_nodes.json.gz');
  const jsonPath = path.join(debugDir, 'figma_nodes.json');

  // Save the compressed file
  fs.writeFileSync(gzPath, req.body);

  // Also gunzip it for immediate use if possible
  try {
    const decompressed = zlib.gunzipSync(req.body);
    fs.writeFileSync(jsonPath, decompressed);
    console.log(`🗜️ Decompressed and saved: ${jsonPath}`);
  } catch (err) {
    console.warn(`⚠️ Failed to decompress figma_nodes.json.gz: ${err.message}`);
  }

  console.log(`📦 Saved compressed Figma nodes: ${gzPath} (${(req.body.length / 1024).toFixed(1)} KB)`);
  res.json({ success: true });
});

/**
 * POST /api/debug/:jobId/figma_summary.json - Upload import summary diagnostics
 */
app.post('/api/debug/:jobId/figma_summary.json', (req, res) => {
  const { jobId } = req.params;
  const debugDir = path.join(artifactsDir, 'debug', jobId);

  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const summaryPath = path.join(debugDir, 'figma_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(req.body, null, 2));

  console.log(`📋 Saved Figma summary: ${summaryPath}`);
  res.json({ success: true });
});

/**
 * POST /api/debug/:jobId/figma_selection_map.json - Upload ID mapping
 */
app.post('/api/debug/:jobId/figma_selection_map.json', (req, res) => {
  const { jobId } = req.params;
  const debugDir = path.join(artifactsDir, 'debug', jobId);

  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const mapPath = path.join(debugDir, 'figma_selection_map.json');
  fs.writeFileSync(mapPath, JSON.stringify(req.body, null, 2));

  console.log(`🗺️ Saved selection map: ${mapPath}`);
  res.json({ success: true });
});

/**
 * POST /api/debug/:jobId/figma_scene_graph.json.gz - Upload scene graph snapshot for gap analysis
 * This contains schemaId-linked Figma nodes with absolute bounding boxes
 */
app.post('/api/debug/:jobId/figma_scene_graph.json.gz', express.raw({ type: 'application/gzip', limit: '100mb' }), (req, res) => {
  const { jobId } = req.params;
  const debugDir = path.join(artifactsDir, 'debug', jobId);

  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const gzPath = path.join(debugDir, 'figma_scene_graph.json.gz');
  const jsonPath = path.join(debugDir, 'figma_scene_graph.json');

  // Save the compressed file
  fs.writeFileSync(gzPath, req.body);

  // Also gunzip it for immediate use if possible
  try {
    const decompressed = zlib.gunzipSync(req.body);
    fs.writeFileSync(jsonPath, decompressed);
    console.log(`🔬 Decompressed and saved scene graph: ${jsonPath}`);
  } catch (err) {
    console.warn(`⚠️ Failed to decompress figma_scene_graph.json.gz: ${err.message}`);
  }

  console.log(`📦 Saved scene graph snapshot: ${gzPath} (${(req.body.length / 1024).toFixed(1)} KB)`);
  res.json({ success: true });
});

/**
 * POST /api/extension/heartbeat - Keep-alive from extension
 */
app.post('/api/extension/heartbeat', (req, res) => {
  telemetry.lastExtensionPingAt = Date.now();
  res.json({ ok: true });
});

/**
 * GET /api/health - Health check endpoint
 */
app.get('/api/health', (req, res) => {
  telemetry.queueLength = jobs.filter(j => !j.deliveredAt).length;

  res.json({
    ok: true,
    queueLength: telemetry.queueLength,
    telemetry,
    connectionStatus: {
      extensionConnected: telemetry.lastExtensionPingAt && (Date.now() - telemetry.lastExtensionPingAt < 30000),
      pluginConnected: telemetry.lastPluginPollAt && (Date.now() - telemetry.lastPluginPollAt < 30000),
      lastExtensionPing: telemetry.lastExtensionPingAt,
      lastPluginPoll: telemetry.lastPluginPollAt
    },
    serverInfo: {
      port: PORT,
      host: HOST,
      version: '1.0.0',
      uptime: (Date.now() - serverStartTime) / 1000
    }
  });
});

/**
 * GET /api/proxy - Proxy endpoint for external images (avoids CORS)
 */
app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ ok: false, error: 'Missing url parameter' });
  }

  try {
    console.log(`🌐 [PROXY] Fetching image: ${url.substring(0, 80)}...`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const dataUrl = `data:${contentType};base64,${base64}`;

    console.log(`✅ [PROXY] Successfully proxied image: ${url.substring(0, 80)}... (${buffer.byteLength} bytes)`);
    
    res.json({
      ok: true,
      data: dataUrl,
      contentType
    });
  } catch (error) {
    console.error(`❌ [PROXY] Failed to proxy image ${url}:`, error.message);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * GET /api/jobs/history - Get all jobs
 */
app.get('/api/jobs/history', (req, res) => {
  res.json({
    jobs: jobs.map(j => ({
      id: j.id,
      status: j.status,
      queuedAt: j.queuedAt,
      deliveredAt: j.deliveredAt,
      completedAt: j.completedAt,
      hasFigmaScreenshot: !!j.figmaScreenshot
    }))
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`\n🚀 Handoff Server running on http://${HOST}:${PORT}`);
  console.log(`📊 Queue length: ${jobs.filter(j => !j.deliveredAt).length}`);
  console.log(`📁 Artifacts directory: ${artifactsDir}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST   /api/jobs - Queue new job`);
  console.log(`  GET    /api/jobs/next - Poll for next job`);
  console.log(`  GET    /api/jobs/recent - Get recent jobs (verification)`);
  console.log(`  POST   /api/jobs/:id/complete - Mark complete + upload screenshot`);
  console.log(`  POST   /api/jobs/:id/screenshot - Upload screenshot`);
  console.log(`  GET    /api/jobs/:id - Get job status`);
  console.log(`  GET    /api/jobs/:id/screenshot - Download screenshot`);
  console.log(`  GET    /api/health - Health check`);
  console.log(`\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  saveJobs();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down...');
  saveJobs();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  saveJobs();
  process.exit(1);
});
