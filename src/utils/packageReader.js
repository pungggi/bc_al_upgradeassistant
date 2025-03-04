const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

/**
 * Read the package.json file directly
 * @returns {Object} The parsed package.json content
 */
function readPackageJson() {
  try {
    // Get the extension's directory path
    const extensionPath = vscode.extensions.getExtension(
      "ngSoftware.bc-al-upgradeassistant"
    )?.extensionPath;

    if (!extensionPath) {
      // Fallback to common locations if extension path can't be determined
      const possibleLocations = [
        // Try current working directory first
        path.join(process.cwd(), "package.json"),
        // Try relative to this file (development scenario)
        path.join(__dirname, "..", "..", "package.json"),
      ];

      for (const location of possibleLocations) {
        if (fs.existsSync(location)) {
          const packageContent = fs.readFileSync(location, "utf8");
          return JSON.parse(packageContent);
        }
      }
      throw new Error("Could not locate package.json");
    }

    // Read and parse the package.json file
    const packageJsonPath = path.join(extensionPath, "package.json");
    const packageContent = fs.readFileSync(packageJsonPath, "utf8");
    return JSON.parse(packageContent);
  } catch (error) {
    console.error("Error reading package.json:", error);
    return null;
  }
}

/**
 * Get model information from package.json
 * @returns {Array} Array of model objects
 */
function getModelDataFromPackage() {
  try {
    const packageJson = readPackageJson();

    if (!packageJson?.contributes?.configuration?.properties) {
      throw new Error("Invalid package.json structure");
    }

    const modelProperty =
      packageJson.contributes.configuration.properties[
        "bc-al-upgradeassistant.claude.model"
      ];

    if (
      !modelProperty ||
      !modelProperty.enum ||
      !modelProperty.enumDescriptions
    ) {
      throw new Error("Model configuration not found in package.json");
    }

    const modelIds = modelProperty.enum;
    const modelDescriptions = modelProperty.enumDescriptions;

    return modelIds.map((modelId, index) => {
      // Parse the description format "Name - Description"
      const description =
        index < modelDescriptions.length ? modelDescriptions[index] : "";
      const parts = description.match(/^(.+?) - (.+)$/);

      return {
        id: modelId,
        name: parts
          ? parts[1]
          : `Claude ${modelId.split("-").slice(1, 3).join(" ")}`,
        description: parts ? parts[2] : description || "Claude model",
        apiName: modelId,
      };
    });
  } catch (error) {
    console.error("Error extracting model data from package.json:", error);
    return [];
  }
}

module.exports = {
  readPackageJson,
  getModelDataFromPackage,
};
