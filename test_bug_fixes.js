// Test script to identify and verify bug fixes
const fetch = require('node-fetch');

async function testAPIEndpoints() {
  console.log('=== Testing API Endpoints ===');
  
  try {
    // Test 1: Server status
    console.log('\n1. Testing server status...');
    const statusRes = await fetch('http://localhost:3000');
    console.log(`✓ Server status: ${statusRes.status} ${statusRes.statusText}`);
    
    // Test 2: Workspaces endpoint
    console.log('\n2. Testing /api/workspaces...');
    const workspacesRes = await fetch('http://localhost:3000/api/workspaces');
    const workspacesData = await workspacesRes.json();
    console.log(`✓ Workspaces: ${JSON.stringify(workspacesData)}`);
    
    // Test 3: Export endpoints
    console.log('\n3. Testing /api/export-docx...');
    const docxRes = await fetch('http://localhost:3000/api/export-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: [{ title: 'Test', content: 'Test content' }] })
    });
    console.log(`✓ DOCX export: ${docxRes.status}`);
    
    console.log('\n4. Testing /api/export-pdf...');
    const pdfRes = await fetch('http://localhost:3000/api/export-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: [{ title: 'Test', content: 'Test content' }] })
    });
    console.log(`✓ PDF export: ${pdfRes.status}`);
    
    // Test 5: Task creation
    console.log('\n5. Testing /api/save-task...');
    const taskRes = await fetch('http://localhost:3000/api/save-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'TEST-01',
        title: 'Test Task',
        content: 'Test content',
        workspace_id: 1
      })
    });
    const taskData = await taskRes.json();
    console.log(`✓ Task creation: ${taskRes.status} - ${JSON.stringify(taskData)}`);
    
  } catch (error) {
    console.error('API test error:', error.message);
  }
}

async function testDatabaseSchema() {
  console.log('\n=== Testing Database Schema ===');
  
  try {
    const Database = require('better-sqlite3');
    const db = new Database('agentos.db');
    
    // Check tasks table columns
    const taskCols = db.prepare('PRAGMA table_info(tasks)').all();
    console.log('\nTasks table columns:');
    taskCols.forEach(col => {
      console.log(`  - ${col.name} (${col.type})`);
    });
    
    // Check if deliverable_type column exists
    const hasDeliverableType = taskCols.some(c => c.name === 'deliverable_type');
    console.log(`\nDeliverable type column exists: ${hasDeliverableType}`);
    
    // Check if is_truncated column exists
    const hasIsTruncated = taskCols.some(c => c.name === 'is_truncated');
    console.log(`Is truncated column exists: ${hasIsTruncated}`);
    
    // Check if workspace_id column exists
    const hasWorkspaceId = taskCols.some(c => c.name === 'workspace_id');
    console.log(`Workspace ID column exists: ${hasWorkspaceId}`);
    
    db.close();
  } catch (error) {
    console.error('Database test error:', error.message);
  }
}

// Run tests
(async () => {
  await testAPIEndpoints();
  await testDatabaseSchema();
  console.log('\n=== All tests completed ===');
})();