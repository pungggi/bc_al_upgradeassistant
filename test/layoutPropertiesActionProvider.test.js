// Mock vscode module first
const vscode = {
  CodeAction: class {
    constructor(title, kind) {
      this.title = title;
      this.kind = kind;
      this.isPreferred = false;
      this.edit = null;
    }
  },
  CodeActionKind: {
    RefactorRewrite: 'refactor.rewrite'
  },
  WorkspaceEdit: class {
    constructor() {
      this.edits = [];
    }
    delete(uri, range) {
      this.edits.push({ type: 'delete', uri, range });
    }
    insert(uri, position, text) {
      this.edits.push({ type: 'insert', uri, position, text });
    }
  },
  Range: class {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },
  Position: class {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }
};

// Mock document
function createMockDocument(content) {
  const lines = content.split('\n');
  return {
    languageId: 'al',
    lineCount: lines.length,
    getText: () => content,
    uri: { path: 'test.al' }
  };
}

// Mock range
function createMockRange() {
  return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(100, 0));
}

// Test cases
async function runTests() {
  console.log('Running LayoutPropertiesActionProvider tests...\n');

  // Import here after mocking
  const { LayoutPropertiesActionProvider } = require('../src/providers/layoutPropertiesActionProvider');
  const provider = new LayoutPropertiesActionProvider();

  // Test 1: Report with DefaultLayout, RDLCLayout, WordLayout, dataset, and requestpage
  console.log('Test 1: Report with old syntax, dataset, and requestpage');
  const testContent1 = `report 50200 "Test Report with Old Syntax"
{
    UsageCategory = ReportsAndAnalysis;
    ApplicationArea = All;
    DefaultLayout = ;
    RDLCLayout = 'src/layouts/TestReport.rdl';
    WordLayout = 'src/layouts/TestReport.docx';

    dataset
    {
        dataitem(Customer; Customer)
        {
            column(No; "No.")
            {
            }
        }
    }

    requestpage
    {
        layout
        {
            area(content)
            {
                group(Options)
                {
                    field(ShowDetails; ShowDetailsVar)
                    {
                        ApplicationArea = All;
                    }
                }
            }
        }
    }
}`;

  const doc1 = createMockDocument(testContent1);
  const range1 = createMockRange();
  const actions1 = await provider.provideCodeActions(doc1, range1);

  console.log(`  Found ${actions1.length} actions`);
  if (actions1.length > 0) {
    console.log(`  Action title: ${actions1[0].title}`);
    console.log(`  Number of edits: ${actions1[0].edit.edits.length}`);

    // Count deletions and insertions
    const deletions = actions1[0].edit.edits.filter(e => e.type === 'delete').length;
    const insertions = actions1[0].edit.edits.filter(e => e.type === 'insert').length;
    console.log(`  Deletions: ${deletions} (should be 3: DefaultLayout, RDLCLayout, WordLayout)`);
    console.log(`  Insertions: ${insertions} (should be 2: DefaultRenderingLayout + rendering block)`);

    // Check if Caption is included in rendering block
    const renderingBlockInsertion = actions1[0].edit.edits.find(e => e.type === 'insert' && e.text.includes('rendering'));
    if (renderingBlockInsertion && renderingBlockInsertion.text.includes("Caption = 'Test Report with Old Syntax'")) {
      console.log(`  ✅ Caption property correctly added with report name`);
    } else {
      console.log(`  ❌ Caption property missing or incorrect`);
    }
  }
  console.log('');

  // Test 2: Report with only DefaultLayout property
  console.log('Test 2: Report with only DefaultLayout property');
  const testContent2 = `report 50202 "Test Report Only DefaultLayout"
{
    UsageCategory = ReportsAndAnalysis;
    ApplicationArea = All;
    DefaultLayout = ;

    dataset
    {
        dataitem(Customer; Customer)
        {
            column(No; "No.")
            {
            }
        }
    }
}`;

  const doc2 = createMockDocument(testContent2);
  const range2 = createMockRange();
  const actions2 = await provider.provideCodeActions(doc2, range2);

  console.log(`  Found ${actions2.length} actions`);
  if (actions2.length > 0) {
    console.log(`  Action title: ${actions2[0].title}`);
    const deletions = actions2[0].edit.edits.filter(e => e.type === 'delete').length;
    const insertions = actions2[0].edit.edits.filter(e => e.type === 'insert').length;
    console.log(`  Deletions: ${deletions} (should be 1: DefaultLayout only)`);
    console.log(`  Insertions: ${insertions} (should be 0: no rendering block since no layout properties)`);
  }
  console.log('');

  // Test 3: Report without requestpage
  console.log('Test 3: Report without requestpage (dataset only)');
  const testContent3 = `report 50201 "Test Report No Requestpage"
{
    UsageCategory = ReportsAndAnalysis;
    ApplicationArea = All;
    DefaultLayout = ;
    RDLCLayout = 'src/layouts/TestReport.rdl';

    dataset
    {
        dataitem(Customer; Customer)
        {
            column(No; "No.")
            {
            }
        }
    }
}`;

  const doc3 = createMockDocument(testContent3);
  const range3 = createMockRange();
  const actions3 = await provider.provideCodeActions(doc3, range3);

  console.log(`  Found ${actions3.length} actions`);
  if (actions3.length > 0) {
    console.log(`  Action title: ${actions3[0].title}`);
    const deletions = actions3[0].edit.edits.filter(e => e.type === 'delete').length;
    const insertions = actions3[0].edit.edits.filter(e => e.type === 'insert').length;
    console.log(`  Deletions: ${deletions} (should be 2: DefaultLayout, RDLCLayout)`);
    console.log(`  Insertions: ${insertions} (should be 2: DefaultRenderingLayout + rendering block)`);

    // Check if Caption is included in rendering block
    const renderingBlockInsertion = actions3[0].edit.edits.find(e => e.type === 'insert' && e.text.includes('rendering'));
    if (renderingBlockInsertion && renderingBlockInsertion.text.includes("Caption = 'Test Report No Requestpage'")) {
      console.log(`  ✅ Caption property correctly added with report name`);
    } else {
      console.log(`  ❌ Caption property missing or incorrect`);
    }
  }
  console.log('');

  // Test 4: Report extension
  console.log('Test 4: Report extension with layout properties');
  const testContent4 = `reportextension 50203 "Test Report Extension" extends "Customer List"
{
    DefaultLayout = ;
    RDLCLayout = 'src/layouts/TestReportExt.rdl';

    rendering
    {
        layout(ExistingLayout)
        {
            Type = Word;
            LayoutFile = 'existing.docx';
        }
    }
}`;

  const doc4 = createMockDocument(testContent4);
  const range4 = createMockRange();
  const actions4 = await provider.provideCodeActions(doc4, range4);

  console.log(`  Found ${actions4.length} actions`);
  if (actions4.length > 0) {
    console.log(`  Action title: ${actions4[0].title}`);
    const deletions = actions4[0].edit.edits.filter(e => e.type === 'delete').length;
    const insertions = actions4[0].edit.edits.filter(e => e.type === 'insert').length;
    console.log(`  Deletions: ${deletions} (should be 2: DefaultLayout, RDLCLayout)`);
    console.log(`  Insertions: ${insertions} (should be 2: DefaultRenderingLayout + rendering block)`);

    // Check if Caption is included in rendering block
    const renderingBlockInsertion = actions4[0].edit.edits.find(e => e.type === 'insert' && e.text.includes('rendering'));
    if (renderingBlockInsertion && renderingBlockInsertion.text.includes("Caption = 'Test Report Extension'")) {
      console.log(`  ✅ Caption property correctly added with reportextension name`);
    } else {
      console.log(`  ❌ Caption property missing or incorrect`);
    }
  }
  console.log('');

  // Test 5: Report with DefaultLayout = Word (specific value)
  console.log('Test 5: Report with DefaultLayout = Word');
  const testContent5 = `report 50004 "PTEY Conf. of Compliance"
{
    UsageCategory = ReportsAndAnalysis;
    ApplicationArea = All;
    DefaultLayout = Word;
    RDLCLayout = './QA/Rep/Rep_ConfofCompliance.rdlc';
    WordLayout = './QA/Rep/Rep_ConfofCompliance.docx';

    dataset { }
    requestpage { }
}`;

  const doc5 = createMockDocument(testContent5);
  const range5 = createMockRange();
  const actions5 = await provider.provideCodeActions(doc5, range5);

  console.log(`  Found ${actions5.length} actions`);
  if (actions5.length > 0) {
    console.log(`  Action title: ${actions5[0].title}`);
    const deletions = actions5[0].edit.edits.filter(e => e.type === 'delete').length;
    const insertions = actions5[0].edit.edits.filter(e => e.type === 'insert').length;
    console.log(`  Deletions: ${deletions} (should be 3: DefaultLayout, RDLCLayout, WordLayout)`);
    console.log(`  Insertions: ${insertions} (should be 2: DefaultRenderingLayout + rendering block)`);

    // Check if DefaultRenderingLayout is set to WordLayout (not RDLCLayout)
    const defaultRenderingInsertion = actions5[0].edit.edits.find(e => e.type === 'insert' && e.text.includes('DefaultRenderingLayout'));
    if (defaultRenderingInsertion && defaultRenderingInsertion.text.includes('DefaultRenderingLayout = WordLayout')) {
      console.log(`  ✅ DefaultRenderingLayout correctly set to WordLayout (respecting DefaultLayout = Word)`);
    } else {
      console.log(`  ❌ DefaultRenderingLayout should be WordLayout, not RDLCLayout`);
      if (defaultRenderingInsertion) {
        console.log(`    Found: ${defaultRenderingInsertion.text.trim()}`);
      }
    }

    // Check rendering block placement (should be after requestpage)
    const renderingBlockInsertion = actions5[0].edit.edits.find(e => e.type === 'insert' && e.text.includes('rendering'));
    if (renderingBlockInsertion) {
      console.log(`  Rendering block insertion at line: ${renderingBlockInsertion.position.line}`);
      // In our test, requestpage is at line 9 (0-indexed), so rendering should be at line 10 (after requestpage)
      if (renderingBlockInsertion.position.line === 10) {
        console.log(`  ✅ Rendering block correctly placed after requestpage section`);
      } else {
        console.log(`  ❌ Rendering block placed at wrong position (should be at line 10, after requestpage at line 9)`);
      }
    }
  }
  console.log('');

  console.log('Tests completed!');
}

// Mock the logger
global.logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  verbose: (msg) => console.log(`[VERBOSE] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`)
};

// Mock vscode globally
global.vscode = vscode;

// Mock the require for vscode module
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'vscode') {
    return vscode;
  }
  return originalRequire.apply(this, arguments);
};

// Run tests
runTests().catch(console.error);
