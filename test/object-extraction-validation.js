const { extractObjects } = require("./test-object-extractor");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

async function runValidationTest() {
  console.log("Starting validation test...\n");

  const testDir = path.join(__dirname, "validation-test-data");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const inputFile = path.join(
    __dirname,
    "..",
    "al-parser-lib",
    "examples",
    "Page",
    "Page5_Currencies.txt"
  );
  const outputDir = path.join(testDir, "output");

  try {
    console.log("Testing object extraction...");
    await extractObjects(inputFile, outputDir, true);

    // Verify the output file exists
    const expectedOutputPath = path.join(
      outputDir,
      "Pages",
      "Page5_Currencies.txt"
    );
    assert(fs.existsSync(expectedOutputPath), "Output file was not created");

    // Read and validate content
    const content = fs.readFileSync(expectedOutputPath, "utf8");
    const lines = content.split("\n");

    // Check for duplicated first line
    assert(
      lines[0].trim() === "OBJECT Page 5 Currencies",
      "First line should be object declaration"
    );
    assert(lines[1].trim() === "{", "Second line should be opening brace");
    assert(
      !lines
        .slice(2)
        .some((line) => line.trim() === "OBJECT Page 5 Currencies"),
      "Object declaration line should not be duplicated"
    );

    // Basic content validation
    assert(
      content.includes("OBJECT-PROPERTIES"),
      "Should contain OBJECT-PROPERTIES"
    );
    assert(content.includes("PROPERTIES"), "Should contain PROPERTIES");
    assert(content.includes("CONTROLS"), "Should contain CONTROLS");
    assert(content.includes("CODE"), "Should contain CODE");

    console.log("Validation test passed successfully!\n");
    return true;
  } catch (error) {
    console.error("Validation test failed:", error);
    throw error;
  } finally {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
}

// Run the test
runValidationTest().then((success) => {
  if (!success) {
    process.exit(1);
  }
});
