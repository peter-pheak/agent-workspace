// Use native fetch API
async function testFixes() {
  console.log('Testing fixes...\n');

  // Test 1: Check if the server is running
  try {
    const res = await fetch('http://localhost:3000/api/workspaces');
    if (res.ok) {
      console.log('✓ Server is running');
    } else {
      console.error('✗ Server is not running');
    }
  } catch (err) {
    console.error('✗ Server is not running:', err.message);
  }

  // Test 2: Test DOCX export
  try {
    const tasks = [
      {
        title: 'Test Task 1',
        instruction: 'This is a test instruction.',
        content: 'This is the content of the task.'
      }
    ];
    const docxRes = await fetch('http://localhost:3000/api/export-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks })
    });
    if (docxRes.ok) {
      console.log('✓ DOCX export is working');
    } else {
      console.error('✗ DOCX export failed:', await docxRes.text());
    }
  } catch (err) {
    console.error('✗ DOCX export error:', err.message);
  }

  // Test 3: Test PDF export
  try {
    const tasks = [
      {
        title: 'Test Task 1',
        instruction: 'This is a test instruction.',
        content: 'This is the content of the task.'
      }
    ];
    const pdfRes = await fetch('http://localhost:3000/api/export-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks })
    });
    if (pdfRes.ok) {
      console.log('✓ PDF export is working');
    } else {
      console.error('✗ PDF export failed:', await pdfRes.text());
    }
  } catch (err) {
    console.error('✗ PDF export error:', err.message);
  }

  // Test 4: Test task creation
  try {
    const res = await fetch('http://localhost:3000/api/save-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'TEST-01',
        title: 'Test Task',
        instruction: 'This is a test task.',
        assignee: 'Planner',
        status: 'todo'
      })
    });
    if (res.ok) {
      console.log('✓ Task creation is working');
    } else {
      console.error('✗ Task creation failed:', await res.text());
    }
  } catch (err) {
    console.error('✗ Task creation error:', err.message);
  }

  console.log('\nAll tests completed.');
}

testFixes().catch(console.error);