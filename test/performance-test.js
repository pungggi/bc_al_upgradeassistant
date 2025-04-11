const { extractObjects } = require("./test-object-extractor");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const v8 = require("v8");

// Helper to generate a large test file
function generateLargeTestFile(filePath, sizeMB) {
  const writeStream = fs.createWriteStream(filePath);
  const targetSize = sizeMB * 1024 * 1024; // Convert MB to bytes
  let currentSize = 0;
  let objectCount = 0;

  const writeObject = () => {
    const object = `
OBJECT Table ${objectCount} Test Table ${objectCount}
{
  OBJECT-PROPERTIES
  {
    Date=20240410D;
    Time=143000T;
    Modified=Yes;
    Version List=Test;
  }
  PROPERTIES
  {
  }
  FIELDS
  {
    { 1; Field1; Text[250]; }
    { 2; Field2; Integer; }
    { 3; Field3; Decimal; }
  }
  CODE
  {
    LOCAL Procedure TestProc()
    BEGIN
      // Generated test procedure
      MESSAGE('Test procedure in object ${objectCount}');
    END;
  }
}
`;

    if (writeStream.write(object)) {
      currentSize += object.length;
      objectCount++;
      if (currentSize < targetSize) {
        writeObject();
      } else {
        writeStream.end();
      }
    } else {
      writeStream.once("drain", writeObject);
    }
  };

  writeObject();

  return new Promise((resolve) => {
    writeStream.on("finish", () => resolve(objectCount));
  });
}

async function validateFiles(outputDir) {
  const results = {
    totalFiles: 0,
    validFiles: 0,
    totalSize: 0,
    filesByType: {},
  };

  // Recursively get all files
  function getAllFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries
      .filter(
        (entry) => entry.isFile() && entry.name !== "_extraction_summary.txt"
      )
      .map((entry) => path.join(dir, entry.name));

    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));

    return [...files, ...directories.flatMap(getAllFiles)];
  }

  const allFiles = getAllFiles(outputDir);
  results.totalFiles = allFiles.length;

  for (const filePath of allFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const stats = fs.statSync(filePath);

      if (
        content.includes("OBJECT ") &&
        content.includes("BEGIN") &&
        content.includes("END")
      ) {
        results.validFiles++;
        results.totalSize += stats.size;

        // Track by object type
        const type = path.basename(path.dirname(filePath));
        results.filesByType[type] = (results.filesByType[type] || 0) + 1;
      }
    } catch (error) {
      console.error(`Error validating file ${filePath}:`, error.message);
    }
  }

  return results;
}

async function runPerformanceTest() {
  console.log("Starting performance test...\n");

  // Create test directory
  const testDir = path.join(__dirname, "test-data");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir);
  }

  const inputFile = path.join(testDir, "large-input.txt");
  const outputDir = path.join(testDir, "output");

  // Generate 200MB test file
  console.log("Generating 200MB test file...");
  const objectCount = await generateLargeTestFile(inputFile, 200);
  console.log(`Generated test file with ${objectCount} objects`);

  // Get file size
  const stats = fs.statSync(inputFile);
  console.log(
    `Input file size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB\n`
  );

  // Memory usage before
  const heapBefore = v8.getHeapStatistics();
  const memBefore = process.memoryUsage();

  // Time the extraction
  const startTime = performance.now();
  let result;

  try {
    console.log("Starting extraction...");
    result = await extractObjects(inputFile, outputDir, true);

    const endTime = performance.now();
    const duration = (endTime - startTime) / 1000; // Convert to seconds

    // Memory usage after
    const heapAfter = v8.getHeapStatistics();
    const memAfter = process.memoryUsage();

    console.log("\nPerformance Results:");
    console.log("-------------------");
    console.log(`Total processing time: ${duration.toFixed(2)} seconds`);
    console.log(`Objects processed: ${result.files.length}`);
    console.log(
      `Processing rate: ${(result.files.length / duration).toFixed(
        2
      )} objects/second`
    );
    console.log(
      `MB/s processed: ${(stats.size / 1024 / 1024 / duration).toFixed(2)} MB/s`
    );

    console.log("\nMemory Usage (MB):");
    console.log("----------------");
    console.log(
      `Heap Used Before: ${(memBefore.heapUsed / 1024 / 1024).toFixed(2)}`
    );
    console.log(
      `Heap Used After: ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)}`
    );
    console.log(
      `Heap Used Delta: ${(
        (memAfter.heapUsed - memBefore.heapUsed) /
        1024 /
        1024
      ).toFixed(2)}`
    );
    console.log(`RSS Before: ${(memBefore.rss / 1024 / 1024).toFixed(2)}`);
    console.log(`RSS After: ${(memAfter.rss / 1024 / 1024).toFixed(2)}`);
    console.log(
      `RSS Delta: ${((memAfter.rss - memBefore.rss) / 1024 / 1024).toFixed(2)}`
    );

    // Heap Statistics
    console.log("\nHeap Statistics (MB):");
    console.log("------------------");
    console.log(
      `Total Heap Size Before: ${(
        heapBefore.total_heap_size /
        1024 /
        1024
      ).toFixed(2)}`
    );
    console.log(
      `Total Heap Size After: ${(
        heapAfter.total_heap_size /
        1024 /
        1024
      ).toFixed(2)}`
    );
    console.log(
      `Used Heap Size Before: ${(
        heapBefore.used_heap_size /
        1024 /
        1024
      ).toFixed(2)}`
    );
    console.log(
      `Used Heap Size After: ${(heapAfter.used_heap_size / 1024 / 1024).toFixed(
        2
      )}`
    );

    // Validation
    console.log("\nValidation:");
    console.log("-----------");
    const validation = await validateFiles(outputDir);
    console.log(`Total files created: ${validation.totalFiles}`);
    console.log(`Valid objects found: ${validation.validFiles}`);
    console.log(
      `Total output size: ${(validation.totalSize / 1024 / 1024).toFixed(2)} MB`
    );

    console.log("\nFiles by Type:");
    Object.entries(validation.filesByType).forEach(([type, count]) => {
      console.log(`${type}: ${count} files`);
    });

    // Compare input/output counts
    if (validation.validFiles !== objectCount) {
      throw new Error(
        `Object count mismatch: ${validation.validFiles} valid files found vs ${objectCount} objects generated`
      );
    }

    return true;
  } catch (error) {
    console.error("Test failed:", error);
    return false;
  } finally {
    // Cleanup
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (err) {
      console.error("Error during cleanup:", err);
    }
  }
}

// Run the test
runPerformanceTest().then((success) => {
  if (success) {
    console.log("\nPerformance test completed successfully");
  } else {
    console.log("\nPerformance test failed");
    process.exit(1);
  }
});
