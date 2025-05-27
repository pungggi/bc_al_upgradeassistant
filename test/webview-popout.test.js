/**
 * Simple test to verify the webview popout functionality
 */

const assert = require('assert');
const path = require('path');

// Mock VS Code API
const vscode = {
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2
  },
  ViewColumn: {
    Beside: 2
  },
  Uri: {
    file: (filePath) => ({ fsPath: filePath, scheme: 'file' })
  },
  window: {
    createWebviewPanel: (viewType, title, showOptions, options) => {
      return {
        webview: {
          html: '',
          asWebviewUri: (uri) => uri,
          onDidReceiveMessage: () => ({ dispose: () => {} })
        },
        onDidDispose: () => ({ dispose: () => {} }),
        reveal: () => {},
        dispose: () => {}
      };
    },
    showInputBox: async (options) => 'test description',
    showErrorMessage: (message) => console.error(message)
  },
  commands: {
    executeCommand: (command, ...args) => console.log('Command executed:', command, args)
  },
  env: {
    openExternal: (uri) => console.log('Opening external:', uri)
  }
};

// Mock context
const context = {
  extensionPath: path.join(__dirname, '..'),
  subscriptions: []
};

// Mock file reference provider
class MockFileReferenceProvider {
  constructor() {
    this.filterMode = 'all';
    this._onDidChangeTreeData = {
      fire: () => {}
    };
  }

  get onDidChangeTreeData() {
    return this._onDidChangeTreeData;
  }

  async getChildren(element) {
    if (!element) {
      return [
        {
          id: 'test1',
          label: 'Test Item 1',
          description: 'Test description',
          contextValue: 'documentationRef',
          collapsibleState: vscode.TreeItemCollapsibleState.None,
          done: false,
          filePath: '/test/file.al',
          lineNumber: 10,
          docId: 'test-doc-1'
        },
        {
          id: 'test2',
          label: 'Test Item 2',
          description: 'Another test',
          contextValue: 'procedureItem',
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          done: true,
          filePath: '/test/file2.al',
          startLine: 20,
          endLine: 30
        }
      ];
    }
    return [];
  }

  setFilterMode(mode) {
    this.filterMode = mode;
    this._onDidChangeTreeData.fire();
  }

  setItemExpandedState(itemId, expanded) {
    // Mock implementation
  }

  toggleDocumentationReferenceDone(filePath, docId, lineNumber) {
    console.log('Toggle done:', filePath, docId, lineNumber);
  }

  setDocumentationReferenceDescription(filePath, docId, lineNumber, description) {
    console.log('Set description:', filePath, docId, lineNumber, description);
  }

  toggleDocumentationReferenceNotImplemented(filePath, docId, lineNumber, description) {
    console.log('Toggle not implemented:', filePath, docId, lineNumber, description);
  }
}

// Test the webview provider
async function testWebviewProvider() {
  console.log('Testing webview provider...');

  // Mock require to return our mocked vscode
  const originalRequire = require;
  require = function(id) {
    if (id === 'vscode') return vscode;
    return originalRequire.apply(this, arguments);
  };

  try {
    // Import the webview provider
    const ReferencesWebviewProvider = originalRequire('../src/views/referencesWebviewProvider');
    
    // Create instances
    const fileReferenceProvider = new MockFileReferenceProvider();
    const webviewProvider = new ReferencesWebviewProvider(fileReferenceProvider, context);

    // Test creating webview
    await webviewProvider.createWebview();
    console.log('✓ Webview created successfully');

    // Test getting current data
    const data = await webviewProvider.getCurrentData();
    assert(data.items.length === 2, 'Should have 2 test items');
    assert(data.filterMode === 'all', 'Filter mode should be "all"');
    console.log('✓ Current data retrieved successfully');

    // Test processing tree items
    const processedItems = await webviewProvider.processTreeItems(await fileReferenceProvider.getChildren());
    assert(processedItems.length === 2, 'Should have 2 processed items');
    assert(processedItems[0].id === 'test1', 'First item should have correct ID');
    assert(processedItems[1].done === true, 'Second item should be marked as done');
    console.log('✓ Tree items processed successfully');

    // Test HTML generation
    const html = webviewProvider.generateHtmlContent(data);
    assert(html.includes('BC/AL References'), 'HTML should contain title');
    assert(html.includes('Test Item 1'), 'HTML should contain test item');
    assert(html.includes('codicon'), 'HTML should include codicon styles');
    console.log('✓ HTML content generated successfully');

    // Test message handling
    await webviewProvider.handleWebviewMessage({ command: 'refresh' });
    console.log('✓ Refresh message handled successfully');

    await webviewProvider.handleWebviewMessage({ command: 'filterDone' });
    assert(fileReferenceProvider.filterMode === 'done', 'Filter mode should be updated to "done"');
    console.log('✓ Filter message handled successfully');

    // Test action handling
    await webviewProvider.handleWebviewMessage({ 
      command: 'toggleDone', 
      itemId: 'test1' 
    });
    console.log('✓ Toggle done message handled successfully');

    // Test disposal
    webviewProvider.dispose();
    console.log('✓ Webview provider disposed successfully');

    console.log('\n✅ All webview provider tests passed!');
    return true;

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    return false;
  } finally {
    // Restore original require
    require = originalRequire;
  }
}

// Test the command registration
function testCommandRegistration() {
  console.log('\nTesting command registration...');

  try {
    // Mock require to return our mocked vscode
    const originalRequire = require;
    require = function(id) {
      if (id === 'vscode') return vscode;
      if (id === './views/referencesWebviewProvider') {
        return class MockReferencesWebviewProvider {
          constructor(fileReferenceProvider, context) {
            this.fileReferenceProvider = fileReferenceProvider;
            this.context = context;
          }
          createWebview() {
            console.log('Mock webview created');
          }
        };
      }
      return originalRequire.apply(this, arguments);
    };

    // Import registerCommands
    const registerCommands = originalRequire('../src/registerCommands');
    
    // Mock context and file reference provider
    const mockContext = {
      subscriptions: []
    };
    const mockFileReferenceProvider = new MockFileReferenceProvider();

    // Test command registration
    registerCommands(mockContext, mockFileReferenceProvider);
    console.log('✓ Commands registered successfully');

    console.log('✅ Command registration test passed!');
    return true;

  } catch (error) {
    console.error('❌ Command registration test failed:', error.message);
    return false;
  }
}

// Run tests
async function runTests() {
  console.log('🧪 Running BC/AL References Webview Popout Tests\n');

  const webviewTest = await testWebviewProvider();
  const commandTest = testCommandRegistration();

  if (webviewTest && commandTest) {
    console.log('\n🎉 All tests passed! The popout functionality is working correctly.');
    process.exit(0);
  } else {
    console.log('\n💥 Some tests failed. Please check the implementation.');
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  testWebviewProvider,
  testCommandRegistration,
  runTests
};
