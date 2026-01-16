#!/usr/bin/env node

/**
 * Debug Runner - Automated Visual & Structural Validation Loop
 * 
 * This tool monitors the handoff server's debug artifacts and runs
 * comprehensive validation on every imported job.
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const zlib = require('zlib');

// Configuration
const ARTIFACTS_ROOT = path.join(__dirname, '..', 'artifacts', 'handoff', 'debug');
const POLL_INTERVAL_MS = 2000;
const PIXEL_THRESHOLD = 0.1;

// Keep track of processed jobs to avoid re-processing
const processedJobs = new Set();

/**
 * Load PNG from disk
 */
function readPng(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.pipe(
      new PNG({ filterType: 4 })
        .on('parsed', function parsed() {
          resolve(this);
        })
        .on('error', reject)
    );
  });
}

/**
 * Perform pixel-by-pixel comparison
 */
async function compareVisuals(jobId, jobDir) {
  const originalPath = path.join(jobDir, 'original_capture.png');
  const figmaPath = path.join(jobDir, 'import_render.png');
  const diffPath = path.join(jobDir, 'visual_diff.png');

  if (!fs.existsSync(originalPath) || !fs.existsSync(figmaPath)) {
    console.log(`[${jobId}] Skipping visual diff - missing images`);
    return null;
  }

  try {
    const [original, figma] = await Promise.all([
      readPng(originalPath),
      readPng(figmaPath)
    ]);

    // Ensure dimensions match for pixelmatch
    // If they don't, it's already a major failure
    if (original.width !== figma.width || original.height !== figma.height) {
      console.warn(`⚠️ [${jobId}] Dimension mismatch: Original ${original.width}x${original.height} vs Figma ${figma.width}x${figma.height}`);
      return {
        error: 'dimension_mismatch',
        originalDim: { w: original.width, h: original.height },
        figmaDim: { w: figma.width, h: figma.height }
      };
    }

    const diff = new PNG({ width: original.width, height: original.height });
    const diffPixels = pixelmatch(
      original.data,
      figma.data,
      diff.data,
      original.width,
      original.height,
      { threshold: PIXEL_THRESHOLD }
    );

    const totalPixels = original.width * original.height;
    const diffPercent = (diffPixels / totalPixels) * 100;

    // Save diff image
    diff.pack().pipe(fs.createWriteStream(diffPath));

    console.log(`📸 [${jobId}] Visual Diff: ${diffPercent.toFixed(2)}% pixels different`);
    return {
      diffPixels,
      diffPercent,
      diffPath
    };
  } catch (err) {
    console.error(`❌ [${jobId}] Visual comparison failed:`, err.message);
    return { error: err.message };
  }
}

/**
 * Analyze structural diagnostics
 */
async function analyzeStructure(jobId, jobDir) {
  const nodesPath = path.join(jobDir, 'figma_nodes.json');
  const summaryPath = path.join(jobDir, 'figma_summary.json');

  if (!fs.existsSync(nodesPath)) {
    console.warn(`⚠️ [${jobId}] figma_nodes.json missing - structural analysis limited`);
    return null;
  }

  try {
    const summary = fs.existsSync(summaryPath) 
      ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')) 
      : null;
    
    const nodes = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));

    // Placeholder for deeper agent-based analysis
    // In a real scenario, we might pass this to an LLM or a set of rules
    const issues = [];
    
    if (summary) {
      if (summary.zeroSizedNodes > 0) issues.push(`${summary.zeroSizedNodes} zero-sized nodes`);
      if (summary.outOfBoundsNodes > 0) issues.push(`${summary.outOfBoundsNodes} out-of-bounds nodes`);
      if (summary.warnings && summary.warnings.length > 0) {
        issues.push(...summary.warnings);
      }
    }

    console.log(`🌳 [${jobId}] Structural Analysis: ${summary ? summary.nodeCount : 'unknown'} nodes, ${issues.length} issues identified`);
    
    return {
      nodeCount: summary ? summary.nodeCount : 0,
      issues,
      summary
    };
  } catch (err) {
    console.error(`❌ [${jobId}] Structural analysis failed:`, err.message);
    return { error: err.message };
  }
}

/**
 * Process a single job directory
 */
async function processJob(jobId) {
  const jobDir = path.join(ARTIFACTS_ROOT, jobId);
  
  // Check if job is "complete" (has minimum required artifacts)
  const required = ['import_report.json', 'import_render.png'];
  const missing = required.filter(f => !fs.existsSync(path.join(jobDir, f)));
  
  if (missing.length > 0) {
    // Job not ready yet
    return false;
  }

  console.log(`\n🚀 [${jobId}] Processing debug artifacts...`);
  
  // 1. Visual Comparison
  const visualResult = await compareVisuals(jobId, jobDir);
  
  // 2. Structural Analysis
  const structuralResult = await analyzeStructure(jobId, jobDir);
  
  // 3. Final Report
  const validationReport = {
    jobId,
    timestamp: new Date().toISOString(),
    visual: visualResult,
    structural: structuralResult,
    status: (visualResult?.diffPercent < 1.0) ? 'PASS' : 'FAIL'
  };

  const reportPath = path.join(jobDir, 'validation_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(validationReport, null, 2));
  
  console.log(`✅ [${jobId}] Validation complete: ${validationReport.status}`);
  if (validationReport.status === 'FAIL') {
    console.log(`   ❌ Visual Diff: ${visualResult?.diffPercent?.toFixed(2)}%`);
  }
  
  return true;
}

/**
 * Main loop
 */
async function main() {
  console.log('👀 Debug Runner started, monitoring artifacts...');
  console.log(`📂 Root: ${ARTIFACTS_ROOT}`);
  
  if (!fs.existsSync(ARTIFACTS_ROOT)) {
    fs.mkdirSync(ARTIFACTS_ROOT, { recursive: true });
  }

  // Initial scan to populate processedJobs
  const initialJobs = fs.readdirSync(ARTIFACTS_ROOT);
  initialJobs.forEach(id => {
    const reportPath = path.join(ARTIFACTS_ROOT, id, 'validation_report.json');
    if (fs.existsSync(reportPath)) {
      processedJobs.add(id);
    }
  });
  
  console.log(`📊 Found ${processedJobs.size} already processed jobs`);

  // Periodic poll
  setInterval(async () => {
    try {
      const currentJobs = fs.readdirSync(ARTIFACTS_ROOT);
      for (const jobId of currentJobs) {
        if (!processedJobs.has(jobId)) {
          const success = await processJob(jobId);
          if (success) {
            processedJobs.add(jobId);
          }
        }
      }
    } catch (err) {
      console.error('⚠️ Error in poll loop:', err.message);
    }
  }, POLL_INTERVAL_MS);
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
