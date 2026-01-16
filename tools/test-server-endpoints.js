/**
 * Minimal test to verify server endpoints work correctly
 */

const fetch = globalThis.fetch || require('node-fetch');

const SERVER_BASE = 'http://localhost:4411';

async function testServerEndpoints() {
  console.log('🧪 Testing server endpoints...\n');

  try {
    // Test 1: Health check
    console.log('1️⃣ Testing GET /api/health...');
    const healthResponse = await fetch(`${SERVER_BASE}/api/health`);
    if (!healthResponse.ok) {
      throw new Error(`Health check failed: ${healthResponse.status}`);
    }
    const healthData = await healthResponse.json();
    console.log('✅ Health check passed');
    console.log(`   Queue length: ${healthData.queueLength}`);
    console.log('');

    // Test 2: POST a minimal job
    console.log('2️⃣ Testing POST /api/jobs...');
    const testPayload = {
      metadata: {
        url: 'https://test.example.com',
        title: 'Test Page',
        captureEngine: 'test'
      },
      root: {
        type: 'FRAME',
        name: 'test-root',
        children: []
      },
      screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    };

    const postResponse = await fetch(`${SERVER_BASE}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload)
    });

    if (!postResponse.ok) {
      const errorText = await postResponse.text();
      throw new Error(`Job POST failed: ${postResponse.status} - ${errorText}`);
    }

    const postData = await postResponse.json();
    console.log('✅ Job posted successfully');
    console.log(`   Job ID: ${postData.id}`);
    console.log(`   Queue position: ${postData.queuePosition}`);
    console.log('');

    // Wait a moment for server to process
    await new Promise(r => setTimeout(r, 1000));

    // Test 3: GET recent jobs
    console.log('3️⃣ Testing GET /api/jobs/recent...');
    const recentResponse = await fetch(`${SERVER_BASE}/api/jobs/recent?limit=5`);
    if (!recentResponse.ok) {
      throw new Error(`Recent jobs failed: ${recentResponse.status}`);
    }

    const recentData = await recentResponse.json();
    console.log('✅ Recent jobs retrieved');
    console.log(`   Total jobs: ${recentData.total}`);
    console.log(`   Pending: ${recentData.pending}`);
    console.log(`   Retrieved: ${recentData.jobs.length}`);

    if (recentData.jobs.length > 0) {
      const latestJob = recentData.jobs[0];
      console.log(`\n   Latest job:`);
      console.log(`     ID: ${latestJob.id}`);
      console.log(`     Status: ${latestJob.status}`);
      console.log(`     Queued: ${new Date(latestJob.queuedAt).toISOString()}`);
      console.log(`     Payload size: ${(latestJob.payloadSize / 1024).toFixed(1)} KB`);
    }

    console.log('\n✅ All server endpoint tests passed!');
    return true;

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    return false;
  }
}

testServerEndpoints().then(success => {
  process.exit(success ? 0 : 1);
});
