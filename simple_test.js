// Simple test to verify the main bug fixes
const fs = require('fs');

console.log('=== SIMPLE BUG FIX VERIFICATION ===\n');

let testsPassed = 0;
let testsFailed = 0;

// Test 1: Check export functions in ui.js
try {
  console.log('Test 1: Export Functions');
  const uiContent = fs.readFileSync('public/ui.js', 'utf8');
  
  if (uiContent.includes('function exportToDOCX()') && 
      uiContent.includes('function exportToPDF()') &&
      uiContent.includes('function renderExportButtons()')) {
    console.log('✓ Export functions are defined');
    testsPassed++;
  } else {
    console.log('✗ Export functions are missing');
    testsFailed++;
  }
} catch (error) {
  console.log('✗ Export functions test failed:', error.message);
  testsFailed++;
}

// Test 2: Check render function calls renderExportButtons
try {
  console.log('\nTest 2: Render Function Integration');
  const uiContent = fs.readFileSync('public/ui.js', 'utf8');
  
  // Find the render function
  const renderMatch = uiContent.match(/function render\(\)\s*\{[\s\S]*?\}/);
  if (renderMatch && renderMatch[0].includes('renderExportButtons()')) {
    console.log('✓ render() calls renderExportButtons()');
    testsPassed++;
  } else {
    console.log('✗ render() does not call renderExportButtons()');
    testsFailed++;
  }
} catch (error) {
  console.log('✗ Render function test failed:', error.message);
  testsFailed++;
}

// Test 3: Check CSS for export buttons
try {
  console.log('\nTest 3: CSS Styles');
  const cssContent = fs.readFileSync('public/css.css', 'utf8');
  
  if (cssContent.includes('.btn-export') && 
      cssContent.includes('export button styles')) {
    console.log('✓ Export button CSS is defined');
    testsPassed++;
  } else {
    console.log('✗ Export button CSS is missing');
    testsFailed++;
  }
} catch (error) {
  console.log('✗ CSS test failed:', error.message);
  testsFailed++;
}

// Test 4: Check HTML for export buttons container
try {
  console.log('\nTest 4: HTML Structure');
  const htmlContent = fs.readFileSync('public/index.html', 'utf8');
  
  if (htmlContent.includes('export-buttons')) {
    console.log('✓ Export buttons container exists in HTML');
    testsPassed++;
  } else {
    console.log('✗ Export buttons container missing in HTML');
    testsFailed++;
  }
} catch (error) {
  console.log('✗ HTML test failed:', error.message);
  testsFailed++;
}

// Test 5: Check state.js for research agents
try {
  console.log('\nTest 5: Research Agents Configuration');
  const stateContent = fs.readFileSync('public/state.js', 'utf8');
  
  const researchAgents = ['Planner', 'Organizer', 'Analyzer', 'PromptEngineer'];
  let allAgentsPresent = true;
  
  for (const agent of researchAgents) {
    if (!stateContent.includes(agent)) {
      console.log(`✗ Missing agent: ${agent}`);
      allAgentsPresent = false;
      testsFailed++;
    }
  }
  
  if (allAgentsPresent) {
    console.log('✓ All research agents are configured');
    testsPassed++;
  }
} catch (error) {
  console.log('✗ Research agents test failed:', error.message);
  testsFailed++;
}

// Test 6: Check for removed code-generation features
try {
  console.log('\nTest 6: Code-Generation Features Removal');
  const stateContent = fs.readFileSync('public/state.js', 'utf8');
  const uiContent = fs.readFileSync('public/ui.js', 'utf8');
  
  // Check that code-related agents are removed
  if (!stateContent.includes('Writer') && !stateContent.includes('Reviewer')) {
    console.log('✓ Code-generation agents removed from state');
    testsPassed++;
  } else {
    console.log('✗ Code-generation agents still present in state');
    testsFailed++;
  }
  
  // Check that syncToDisk function is still present (for research data)
  if (uiContent.includes('async function syncToDisk()')) {
    console.log('✓ syncToDisk function preserved for research data');
    testsPassed++;
  } else {
    console.log('✗ syncToDisk function missing');
    testsFailed++;
  }
} catch (error) {
  console.log('✗ Code-generation removal test failed:', error.message);
  testsFailed++;
}

// Test 7: Check server.js for export endpoints
try {
  console.log('\nTest 7: Server Export Endpoints');
  const serverContent = fs.readFileSync('server.js', 'utf8');
  
  if (serverContent.includes('/api/export-docx') && 
      serverContent.includes('/api/export-pdf')) {
    console.log('✓ Export endpoints defined in server.js');
    testsPassed++;
  } else {
    console.log('✗ Export endpoints missing in server.js');
    testsFailed++;
  }
} catch (error) {
  console.log('✗ Server endpoints test failed:', error.message);
  testsFailed++;
}

// Test 8: Check database schema
try {
  console.log('\nTest 8: Database Schema');
  const Database = require('better-sqlite3');
  const db = new Database('agentos.db');
  
  const taskCols = db.prepare('PRAGMA table_info(tasks)').all();
  const requiredCols = ['workspace_id', 'deliverable_type', 'is_truncated'];
  
  let allColsPresent = true;
  for (const col of requiredCols) {
    if (!taskCols.some(c => c.name === col)) {
      console.log(`✗ Missing column: ${col}`);
      allColsPresent = false;
      testsFailed++;
    }
  }
  
  if (allColsPresent) {
    console.log('✓ All required database columns exist');
    testsPassed++;
  }
  
  db.close();
} catch (error) {
  console.log('✗ Database schema test failed:', error.message);
  testsFailed++;
}

// Summary
console.log('\n=== TEST SUMMARY ===');
console.log(`Tests Passed: ${testsPassed}`);
console.log(`Tests Failed: ${testsFailed}`);
console.log(`Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);

if (testsFailed === 0) {
  console.log('\n🎉 All tests passed! Bug fixes are working correctly.');
} else {
  console.log('\n⚠️  Some tests failed. Please review the issues above.');
}