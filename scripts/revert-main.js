/**
 * Revert main script for BC/AL Upgrade Assistant
 *
 * This script reverts the main entry point back to the source file
 * after publishing is complete
 */
const fs = require("fs");
const path = require("path");

const packageJsonPath = path.join(__dirname, "..", "package.json");

try {
  // Read the package.json file
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  // Update main entry point back to source
  pkg.main = "./src/extension.js";

  // Write the updated package.json
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2));

  console.log(`Reverted main to ${pkg.main}`);
} catch (error) {
  console.error("Error reverting package.json:", error);
  process.exit(1);
}
