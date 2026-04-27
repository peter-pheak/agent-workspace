// Comprehensive test to verify all bug fixes
const fetch = require('node-fetch');
const fs = require('fs');

async function runComprehensiveTests() {
  console.log('=== COMPREHENSIVE BUG FIX TESTS ===\n');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Test 1: Database Schema Verification
  try {
    console.log('Test 1: Database Schema Verification');
    const Database = require('better-sqlite3');
    const db = new Database('agentos.db');
    
    const taskCols = db.prepare('PRAGMA table_info(tasks)').all();
    const requiredCols = ['id', 'workspace_id', 'deliverable_type', 'is_truncated'];
    const missingCols = requiredCols.filter(col => !taskCols.some(c => c.name === col));
    
    if (missingCols.length === 0) {
      console.log('✓ All required database columns exist');
      testsPassed++;
    } else {
      console.log('✗ Missing database columns:', missingCols);
      testsFailed++;
    }
    
    db.close();
  } catch (error) {
    console.log('✗ Database test failed:', error.message);
    testsFailed++;
  }
  
  // Test 2: API Endpoints
  try {
    console.log('\nTest 2: API Endpoints');
    
    // Test workspaces endpoint
    const workspacesRes = await fetch('http://localhost:3000/api/workspaces');
    if (workspacesRes.ok) {
      console.log('✓ /api/workspaces endpoint working');
      testsPassed++;
    } else {
      console.log('✗ /api/workspaces endpoint failed');
      testsFailed++;
    }
    
    // Test export endpoints
    const exportData = { tasks: [{ title: 'Test', content: 'Test content' }]};
    
    const docxRes = await fetch('http://localhost:3000/api/export-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exportData)
    });
    
    if (docxRes.ok) {
      console.log('✓ /api/export-docx endpoint working');
      testsPassed++;
    } else {
      console.log('✗ /api/export-docx endpoint failed');
      testsFailed++;
    }
    
    const pdfRes = await fetch('http://localhost:3000/api/export-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exportData)
    });
    
    if (pdfRes.ok) {
      console.log('✓ /api/export-pdf endpoint working');
      testsPassed++;
    } else {
      console.log('✗ /api/export-pdf endpoint failed');
      testsFailed++;
    }
    
  } catch (error) {
    console.log('✗ API endpoints test failed:', error.message);
    testsFailed++;
  }
  
  // Test 3: File System Verification
  try {
    console.log('\nTest 3: File System Verification');
    
    // Check if required files exist
    const requiredFiles = [
      'public/ui.js',
      'public/state.js', 
      'public/engine.js',
      'public/core.js',
      'public/init.js',
      'public/prompts.js',
      'public/css.css',
      'public/index.html'
    ];
    
    let allFilesExist = true;
    for (const file of requiredFiles) {
      if (!fs.existsSync(file)) {
        console.log(`✗ Missing file: ${file}`);
        allFilesExist = false;
        testsFailed++;
      }
    }
    
    if (allFilesExist) {
      console.log('✓ All required files exist');
      testsPassed++;
    }
    
    // Check if export functions are defined in ui.js
    const uiContent = fs.readFileSync('public/ui.js', 'utf8');
    if (uiContent.includes('function exportToDOCX()') && uiContent.includes('function exportToPDF()')) {
      console.log('✓ Export functions defined in ui.js');
      testsPassed++;
    } else {
      console.log('✗ Export functions missing in ui.js');
      testsFailed++;
    }
    
    // Check if renderExportButtons is called in render function
    if (uiContent.includes('renderExportButtons()')) {
      console.log('✓ renderExportButtons() called in render()');
      testsPassed++;
    } else {
      console.log('✗ renderExportButtons() not called in render()');
      testsFailed++;
    }
    
  } catch (error) {
    console.log('✗ File system test failed:', error.message);
    testsFailed++;
  }
  
  // Test 4: State Configuration
  try {
    console.log('\nTest 4: State Configuration');
    
    const stateContent = fs.readFileSync('public/state.js', 'utf8');
    
    // Check for research-focused agents
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
      console.log('✓ All research agents configured');
      testsPassed++;
    }
    
    // Check for removed code-generation features
    if (!stateContent.includes('Writer') && !stateContent.includes('Reviewer')) {
      console.log('✓ Code-generation agents removed');
      testsPassed++;
    } else {
      console.log('✗ Code-generation agents still present');
      testsFailed++;
    }
    
  } catch (error) {
    console.log('✗ State configuration test failed:', error.message);
    testsFailed++;
  }
  
  // Test 5: Export Button CSS
  try {
    console.log('\nTest 5: Export Button CSS');
    
    const cssContent = fs.readFileSync('public/css.css', 'utf8');
    
    if (cssContent.includes('.btn-export') && cssContent.includes('export button styles')) {
      console.log('✓ Export button CSS defined');
      testsPassed++;
    } else {
      console.log('✗ Export button CSS missing');
      testsFailed++;
    }
    
  } catch (error) {
    console.log('✗ CSS test failed:', error.message);
    testsFailed++;
  }
  
  // Test 6: HTML Export Buttons Container
  try {
    console.log('\nTest 6: HTML Export Buttons Container');
    
    const htmlContent = fs.readFileSync('public/index.html', 'utf8');
    
    if (htmlContent.includes('export-buttons')) {
      console.log('✓ Export buttons container in HTML');
      testsPassed++;
    } else {
      console.log('✗ Export buttons container missing in HTML');
      testsFailed++;
    }
    
  } catch (error) {
    console.log('✗ HTML test failed:', error.message);
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
}

// Run the tests
runComprehensiveTests().catch(console.error);