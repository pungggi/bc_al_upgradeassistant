const path = require("path");
const fs = require("fs");
// We can't use the logger here because it would create a circular dependency

/**
 * Read values from package.json
 * @returns {Object} Package information including EXTENSION_ID and PUBLISHER
 * @throws {Error} If package.json cannot be read or parsed
 */
function getPackageInfo() {
  try {
    // Determine the path to package.json (root of the extension)
    const packagePath = path.join(__dirname, "..", "package.json");

    // Check if package.json exists
    if (!fs.existsSync(packagePath)) {
      throw new Error(`package.json not found at: ${packagePath}`);
    }

    // Read and parse package.json
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

    // Verify required fields exist
    if (!packageJson.name) {
      throw new Error("Missing 'name' field in package.json");
    }
    if (!packageJson.publisher) {
      throw new Error("Missing 'publisher' field in package.json");
    }

    return {
      EXTENSION_ID: packageJson.name,
      PUBLISHER: packageJson.publisher,
      VERSION: packageJson.version,
    };
  } catch (error) {
    // Rethrow with more context
    throw new Error(
      `Failed to read extension metadata from package.json: ${error.message}`
    );
  }
}

// Extract constants from package.json (will throw if there's a problem)
const { EXTENSION_ID, PUBLISHER, VERSION } = getPackageInfo();

module.exports = {
  EXTENSION_ID,
  PUBLISHER,
  VERSION,
  // Export the function too in case we need to refresh these values
  getPackageInfo,
};
