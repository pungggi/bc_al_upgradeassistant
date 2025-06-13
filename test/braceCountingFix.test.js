const { extractReportLayouts } = require("../src/utils/alLayoutParser.js");

/**
 * Test case for the brace counting fix
 * This test verifies that braces inside comments and strings are properly ignored
 * when parsing AL layout rendering blocks.
 */

console.log("Testing brace counting fix for AL Layout Parser...");

// Test case with braces inside strings and comments
const testALCodeWithBracesInStringsAndComments = `
report 50000 "Test Report"
{
    rendering
    {
        layout(RDLCLayout)
        {
            // This comment has { braces } in it
            Caption = 'Test Layout with { braces } in string';
            LayoutFile = 'Reports/TestReport.rdl';
            Type = RDLC;
        }
        layout(WordLayout)
        {
            Caption = "Another layout with } brace in string";
            LayoutFile = 'Reports/TestReport.docx';
            Type = Word;
        }
        layout(ExcelLayout)
        {
            /* Block comment with { braces } */
            Caption = 'Excel layout with "nested quotes" and { braces }';
            LayoutFile = "Reports/TestReport.xlsx";
            Type = Excel;
        }
    }
}
`;

// Test case with escaped quotes in AL strings
const testALCodeWithEscapedQuotes = `
report 50001 "Test Report with Escaped Quotes"
{
    rendering
    {
        layout(TestLayout)
        {
            Caption = 'Layout with ''escaped quotes'' and { braces }';
            LayoutFile = 'Reports/TestWithEscapedQuotes.rdl';
            Type = RDLC;
        }
    }
}
`;

// Test case with nested braces in normal code (should still work)
const testALCodeWithNestedBraces = `
report 50002 "Test Report with Nested Braces"
{
    rendering
    {
        layout(NestedLayout)
        {
            Caption = 'Normal layout';
            LayoutFile = 'Reports/Nested.rdl';
            Type = RDLC;
            // Some property with nested structure
            Properties = {
                SubProperty = {
                    Value = 'test';
                };
            };
        }
    }
}
`;

// Run tests
console.log("\n1. Testing braces in strings and comments...");
const layouts1 = extractReportLayouts(testALCodeWithBracesInStringsAndComments);
if (layouts1.length === 3) {
    console.log("✅ SUCCESS: Correctly extracted 3 layouts despite braces in comments and strings");
    layouts1.forEach((layout, index) => {
        console.log(`   Layout ${index + 1}: ${layout.label} → ${layout.path}`);
    });
} else {
    console.log(`❌ FAILED: Expected 3 layouts, got ${layouts1.length}`);
    console.log("Extracted layouts:", layouts1);
}

console.log("\n2. Testing escaped quotes in AL strings...");
const layouts2 = extractReportLayouts(testALCodeWithEscapedQuotes);
if (layouts2.length === 1 && layouts2[0].label.includes("escaped quotes")) {
    console.log("✅ SUCCESS: Correctly handled escaped quotes in AL strings");
    console.log(`   Layout: ${layouts2[0].label} → ${layouts2[0].path}`);
} else {
    console.log(`❌ FAILED: Expected 1 layout with escaped quotes, got ${layouts2.length}`);
    console.log("Extracted layouts:", layouts2);
}

console.log("\n3. Testing nested braces in normal code...");
const layouts3 = extractReportLayouts(testALCodeWithNestedBraces);
if (layouts3.length === 1) {
    console.log("✅ SUCCESS: Correctly handled nested braces in normal code");
    console.log(`   Layout: ${layouts3[0].label} → ${layouts3[0].path}`);
} else {
    console.log(`❌ FAILED: Expected 1 layout with nested braces, got ${layouts3.length}`);
    console.log("Extracted layouts:", layouts3);
}

console.log("\n🎉 Brace counting fix tests completed!");
