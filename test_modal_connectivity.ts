#!/usr/bin/env tsx

import { ModalClient } from './src/utils/modalClient.js';

/**
 * Test script to verify Modal endpoint connectivity
 */
async function testModalConnectivity() {
  console.log('🧪 Testing Modal Connectivity...\n');

  // Test 1: Health Check
  console.log('📋 Test 1: Health Check');
  console.log('=' .repeat(50));

  const modalClient = new ModalClient();
  const healthResult = await modalClient.healthCheck();

  console.log(`Status: ${healthResult.status}`);
  console.log(`Message: ${healthResult.message}`);

  if (healthResult.status === 'healthy') {
    console.log('✅ Health check passed!\n');
  } else {
    console.log('❌ Health check failed!\n');
    return;
  }

  // Test 2: Test Transcription (optional - requires real YouTube URL)
  console.log('📋 Test 2: Test Transcription Request');
  console.log('=' .repeat(50));

  const testYoutubeUrl = 'https://youtu.be/dQw4w9WgXcQ'; // Test URL
  console.log(`Testing with YouTube URL: ${testYoutubeUrl}`);

  try {
    const result = await modalClient.submitJob({
      youtube_url: testYoutubeUrl,
      job_id: 'test-job-123',
      openai_model: 'whisper-1'
    });

    console.log(`Job Status: ${result.status}`);
    console.log(`Success: ${result.success}`);

    if (result.success) {
      console.log('✅ Transcription test passed!');
    } else {
      console.log('❌ Transcription test failed!');
      console.log(`Error: ${result.error?.message}`);
    }
  } catch (error) {
    console.log('❌ Transcription test error:', error);
  }

  console.log('\n🎉 Modal connectivity test completed!');
}

// Run the test
testModalConnectivity().catch(console.error);