const { extractReportLayouts } = require("../src/utils/alLayoutParser.js");
const { getObjectDefinition } = require("../src/al-parser-lib/alparser.js");

// Test the rendering block functionality
const testReportWithRendering = `report 50100 "Test Report"
{
    rendering
    {
        layout(RDLCLayout)
        {
            Type = RDLC;
            LayoutFile = '.\_Base\report\terwet.rdl';
            Caption = 'Test RDLC Layout';
        }
        layout(WordLayout)
        {
            Type = Word;
            LayoutFile = '_Base\report\terwet.docx';
            Caption = 'Test Word Layout';
        }
    }
}`;

console.log("Testing getObjectDefinition...");
const objectDef = getObjectDefinition(testReportWithRendering);
console.log("Object definition:", JSON.stringify(objectDef, null, 2));

console.log("\nTesting rendering block regex...");
const renderingBlockRegex = /rendering\s*\{([\s\S]*?)\}/i;
const renderingBlockMatch = testReportWithRendering.match(renderingBlockRegex);
console.log("Rendering block found:", !!renderingBlockMatch);
if (renderingBlockMatch) {
  console.log("Rendering content:", renderingBlockMatch[1]);

  const renderingContent = renderingBlockMatch[1];
  const layoutBlockRegex = /layout\s*\(([^)]+)\)\s*\{([\s\S]*?)\}/gi;
  let layoutMatch;
  let layoutCount = 0;

  while ((layoutMatch = layoutBlockRegex.exec(renderingContent)) !== null) {
    layoutCount++;
    console.log(`Layout ${layoutCount}:`, layoutMatch[1].trim());
    console.log(`Layout content:`, layoutMatch[2]);
  }
}

console.log("\nTesting extractReportLayouts with rendering block...");
const layouts = extractReportLayouts(testReportWithRendering);
console.log("Found layouts:", JSON.stringify(layouts, null, 2));

console.log("\nTesting path unescaping...");
layouts.forEach((layout, index) => {
  console.log(`Layout ${index + 1} path: "${layout.path}"`);
});

// Expected output:
// [
//   { label: 'Test RDLC Layout (RDLCLayout)', path: '._Base\report\terwet.rdl' },
//   { label: 'Test Word Layout (WordLayout)', path: '_Base\report\terwet.docx' }
// ]

if (layouts.length === 2) {
  console.log("✅ SUCCESS: Found 2 layouts as expected");
  console.log("✅ Layout 1:", layouts[0].label, "→", layouts[0].path);
  console.log("✅ Layout 2:", layouts[1].label, "→", layouts[1].path);
} else {
  console.log("❌ FAILED: Expected 2 layouts, got", layouts.length);
}
