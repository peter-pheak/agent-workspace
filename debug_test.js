// Debug test script to identify JavaScript errors
console.log('Starting debug test...');

// Test 1: Check if basic functions are defined
try {
  console.log('Test 1: Checking basic function definitions');
  
  if (typeof render === 'undefined') {
    console.error('ERROR: render() function is undefined');
  } else {
    console.log('✓ render() is defined');
  }
  
  if (typeof setView === 'undefined') {
    console.error('ERROR: setView() function is undefined');
  } else {
    console.log('✓ setView() is defined');
  }
  
  if (typeof setFilter === 'undefined') {
    console.error('ERROR: setFilter() function is undefined');
  } else {
    console.log('✓ setFilter() is defined');
  }
  
  if (typeof createNewProject === 'undefined') {
    console.error('ERROR: createNewProject() function is undefined');
  } else {
    console.log('✓ createNewProject() is defined');
  }
  
  if (typeof openSettings === 'undefined') {
    console.error('ERROR: openSettings() function is undefined');
  } else {
    console.log('✓ openSettings() is defined');
  }
  
} catch (e) {
  console.error('Test 1 failed:', e.message);
}

// Test 2: Check state initialization
try {
  console.log('\nTest 2: Checking state initialization');
  
  if (typeof S === 'undefined') {
    console.error('ERROR: S state object is undefined');
  } else {
    console.log('✓ S state object is defined');
    console.log('State properties:', Object.keys(S));
  }
  
} catch (e) {
  console.error('Test 2 failed:', e.message);
}

// Test 3: Check DOM elements
try {
  console.log('\nTest 3: Checking DOM elements');
  
  const elementsToCheck = [
    'workspace-select',
    'goal-input', 
    'task-board',
    'export-buttons',
    'settings-btn'
  ];
  
  elementsToCheck.forEach(id => {
    const el = document.getElementById(id);
    if (!el) {
      console.error(`ERROR: Element #${id} not found in DOM`);
    } else {
      console.log(`✓ Element #${id} found`);
    }
  });
  
} catch (e) {
  console.error('Test 3 failed:', e.message);
}

// Test 4: Check export functionality
try {
  console.log('\nTest 4: Checking export functionality');
  
  if (typeof exportToDOCX === 'undefined') {
    console.error('ERROR: exportToDOCX() function is undefined');
  } else {
    console.log('✓ exportToDOCX() is defined');
  }
  
  if (typeof exportToPDF === 'undefined') {
    console.error('ERROR: exportToPDF() function is undefined');
  } else {
    console.log('✓ exportToPDF() is defined');
  }
  
} catch (e) {
  console.error('Test 4 failed:', e.message);
}

console.log('\nDebug test completed.');