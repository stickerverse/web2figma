const puppeteer = require('puppeteer');
const path = require('path');

// Use node-fetch if global fetch is not available (Node < 18)
const fetch = globalThis.fetch || require('node-fetch');

const EXTENSION_PATH = path.resolve(__dirname, '../chrome-extension/dist');
const URL_TO_CAPTURE = process.argv[2] || 'https://etsy.com';
const SERVER_BASE = 'http://localhost:4411';

/**
 * Visual Automation Runner
 * Simulates a user opening the extension popup and clicking capture.
 */
(async () => {
  console.log(`🚀 [AUTOMATION] Starting capture for: ${URL_TO_CAPTURE}`);
  
  // 1. Preflight check
  try {
    const health = await fetch(`${SERVER_BASE}/api/health`);
    if (!health.ok) throw new Error('Server not responding');
    console.log('✅ [AUTOMATION] Handoff server is healthy');
  } catch (e) {
    console.error('❌ [AUTOMATION] Handoff server not found. Run "node handoff-server.cjs" first.');
    process.exit(1);
  }

  // 2. Launch Browser with Extension
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--window-size=1600,1000'
    ]
  });

  try {
    // 3. Wait for extension to load
    console.log('⏳ [AUTOMATION] Waiting for extension to load...');
    await new Promise(r => setTimeout(r, 2000));

    // 4. Find Extension ID
    console.log('🔍 [AUTOMATION] Locating extension...');
    const targets = await browser.targets();
    const backgroundTarget = targets.find(t => t.type() === 'service_worker');

    if (!backgroundTarget) {
      throw new Error('Could not find extension background service worker');
    }

    const extensionId = backgroundTarget.url().split('/')[2];
    console.log(`✅ [AUTOMATION] Found Extension ID: ${extensionId}`);

    // 5. Open Extension Popup with URL parameter
    // The popup will auto-fill the URL input and allow capturing without opening the target page first
    console.log('🪟 [AUTOMATION] Opening extension popup UI...');
    const encodedUrl = encodeURIComponent(URL_TO_CAPTURE);
    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html?url=${encodedUrl}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // 6. Wait for popup to initialize and detect server/plugin
    console.log('⏳ [AUTOMATION] Waiting for popup to initialize...');
    await new Promise(r => setTimeout(r, 3000));

    // 7. Click "Capture & Send to Figma"
    console.log('🖱️ [AUTOMATION] Clicking "Capture & Send to Figma" button...');
    await popupPage.waitForSelector('#capture-btn', { timeout: 10000 });
    await popupPage.click('#capture-btn');
    console.log('✅ [AUTOMATION] Capture triggered via popup UI');

    // 8. Monitor server for the resulting job
    console.log('⏳ [AUTOMATION] Waiting for job to appear on handoff server...');
    const startPoll = Date.now();
    const timeout = 300000; // 5 minutes
    let confirmed = false;

    while (Date.now() - startPoll < timeout) {
      const response = await fetch(`${SERVER_BASE}/api/jobs/recent?limit=1`);
      const data = await response.json();
      
      if (data.jobs && data.jobs.length > 0) {
        const latestJob = data.jobs[0];
        // If the job was created after we started this script, it's ours
        if (latestJob.queuedAt > startPoll - 10000) {
          console.log(`\n🎉 [AUTOMATION] SUCCESS: Job ${latestJob.id} is confirmed on server!`);
          confirmed = true;
          break;
        }
      }
      
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, 5000));
    }

    if (!confirmed) {
      throw new Error('Timeout waiting for job to appear on server');
    }

  } catch (err) {
    console.error(`\n❌ [AUTOMATION] Fatal error: ${err.message}`);
  } finally {
    console.log('👋 [AUTOMATION] Closing browser...');
    await browser.close();
  }
})();