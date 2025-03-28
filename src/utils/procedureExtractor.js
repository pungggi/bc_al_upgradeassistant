const fs = require("fs");
const path = require("path");
const glob = require("glob");
const vscode = require("vscode");

// Cache for procedures by object name and type
let proceduresCache = {};
// Last time the cache was updated
let lastCacheUpdate = 0;

/**
 * Get configuration value
 * @param {string} key - Configuration key
 * @param {any} defaultValue - Default value if not found
 * @returns {any} - Configuration value
 */
function getConfigValue(key, defaultValue) {
  const config = vscode.workspace.getConfiguration("bc-al-upgradeassistant");
  return config.get(key, defaultValue);
}

/**
 * Parse AL file to extract global procedure information
 * @param {string} filePath - Path to AL file
 * @returns {Object|null} - Object with objectName, objectType and procedures array, or null
 */
function extractProceduresFromObjects(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");

    // Extract object type and name
    const objectMatch = content.match(
      /\b(table|page|codeunit|report|query|xmlport)\s+(\d+)\s+["']([^"']+)["']/i
    );
    if (!objectMatch) {
      return null;
    }

    const objectType = objectMatch[1].toLowerCase();
    const objectName = objectMatch[3];

    // Extract global procedures (not starting with 'local')
    const procedures = [];

    // Split content into lines for better procedure parsing
    const lines = content.split(/\r?\n/);
    let currentProcedure = null;
    let procedureLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Look for procedure start
      // Match procedure that doesn't have 'local' before it
      const procMatch = line.match(
        /^(?!.*\blocal\s+)procedure\s+["']?([^"'\s(]+)["']?\s*\((.*)\)(:\s*(.+))?;/i
      );

      if (procMatch) {
        if (currentProcedure) {
          // Store previous procedure if exists
          procedures.push({
            name: currentProcedure.name,
            parameters: currentProcedure.parameters,
            returnType: currentProcedure.returnType,
            body: procedureLines.join("\n"),
          });
        }

        // Start new procedure
        currentProcedure = {
          name: procMatch[1],
          parameters: procMatch[2]
            .split(",")
            .map((param) => param.trim())
            .filter((p) => p),
          returnType: procMatch[4] ? procMatch[4].trim() : null,
        };
        procedureLines = [line];
        continue;
      }

      // If we're in a procedure, collect its lines
      if (currentProcedure) {
        procedureLines.push(line);

        // Check for procedure end
        if (line.toLowerCase() === "end;") {
          procedures.push({
            name: currentProcedure.name,
            parameters: currentProcedure.parameters,
            returnType: currentProcedure.returnType,
            body: procedureLines.join("\n"),
          });
          currentProcedure = null;
          procedureLines = [];
        }
      }
    }

    return { objectType, objectName, procedures };
  } catch (error) {
    console.error(`Error extracting procedures from ${filePath}:`, error);
    return null;
  }
}

/**
 * Get procedures for a specific object
 * @param {string} objectType - Type of the object (table, page, etc.)
 * @param {string} objectName - Name of the object
 * @returns {Promise<Array>} - Array of procedures
 */
async function getProceduresForObject(objectType, objectName) {
  if (!objectType || !objectName) {
    return [];
  }

  await ensureCacheIsUpToDate();

  const cacheKey = `${objectType}:${objectName}`;
  return proceduresCache[cacheKey] || [];
}

/**
 * Update the procedures cache from source files
 * @returns {Promise<void>}
 */
async function updateProceduresCache() {
  const srcPath = getConfigValue("srcExtractionPath", "");
  if (!srcPath) {
    console.warn("Source extraction path not configured");
    return;
  }

  try {
    const alFiles = glob.sync(path.join(srcPath, "**", "*.al"));
    proceduresCache = {};

    for (const filePath of alFiles) {
      const result = extractProceduresFromObjects(filePath);
      if (result && result.objectName && result.procedures.length) {
        const cacheKey = `${result.objectType}:${result.objectName}`;
        proceduresCache[cacheKey] = result.procedures;
      }
    }

    lastCacheUpdate = Date.now();
    console.log(
      `Updated procedures cache with ${
        Object.keys(proceduresCache).length
      } objects`
    );
  } catch (error) {
    console.error("Error updating procedures cache:", error);
  }
}

/**
 * Ensure the procedures cache is up-to-date
 * @returns {Promise<void>}
 */
async function ensureCacheIsUpToDate() {
  const cacheTimeout =
    getConfigValue("fieldSuggestion.cacheTimeout", 600) * 1000;
  if (Date.now() - lastCacheUpdate > cacheTimeout) {
    await updateProceduresCache();
  }
}

/**
 * Get all known objects with procedures
 * @returns {Promise<Array>} - Array of object identifiers (type:name)
 */
async function getAllObjectsWithProcedures() {
  await ensureCacheIsUpToDate();
  return Object.keys(proceduresCache);
}

module.exports = {
  getProceduresForObject,
  updateProceduresCache,
  ensureCacheIsUpToDate,
  getAllObjectsWithProcedures,
  extractProceduresFromObjects,
};
