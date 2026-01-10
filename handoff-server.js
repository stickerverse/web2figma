/**
 * Handoff Server - Coordinates data transfer between Extension/Puppeteer and Figma Plugin
 * Includes screenshot upload support for visual validation feedback loop
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 4411;
const HOST = process.env.HOST || '0.0.0.0';

// Increase payload limit for large schemas with screenshots
app.use(express.json({ limit: '100mb' }));
app.use(express.raw({ type: 'image/png', limit: '50mb' }));
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

  console.log(`✅ Job queued: ${jobId} (${(JSON.stringify(req.body).length / 1024).toFixed(1)} KB)`);

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
      id: nextJob.id,
      payload: nextJob.payload,
      queuedAt: nextJob.queuedAt
    });
  } else {
    res.json({ id: null });
  }
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
