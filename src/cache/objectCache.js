const vscode = require("vscode");
const { readFileContent } = require("../utils/fileUtils");
const {
  parseRegularObject,
  enrichObjectInfo,
} = require("../parsers/alObjectParser");
const { parseExtensionObject } = require("../parsers/alExtensionParser");

// Cache for extension object information
let objectInfoCache = new Map(); // Key: type:name (lowercase)
let cacheInitialized = false;
let cacheInitializing = false;
let objectCache = {};
let initialized = false;
let initializing = false;
let lastInitTime = null;

/**
 * Initialize the cache with all extension objects in the workspace
 * @param {boolean} forceRefresh Force a refresh of the cache
 * @returns {Promise<void>}
 */
async function initializeCache(forceRefresh = false) {
  // Prevent multiple initializations running simultaneously
  if ((cacheInitialized && !forceRefresh) || cacheInitializing) {
    return;
  }

  try {
    cacheInitializing = true;
    objectInfoCache.clear();

    vscode.window.setStatusBarMessage(
      "Initializing extension object info cache...",
      3000
    );

    // First pass: Find all regular objects and cache their info
    const baseObjectFiles = await vscode.workspace.findFiles("**/*.al");

    // Process files in smaller batches to avoid overwhelming the system
    const batchSize = 20;
    for (let i = 0; i < baseObjectFiles.length; i += batchSize) {
      const batch = baseObjectFiles.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (file) => {
          await cacheObjectInfo(file);
        })
      );
    }

    // Second pass: Find all extension objects and link them to base objects
    for (let i = 0; i < baseObjectFiles.length; i += batchSize) {
      const batch = baseObjectFiles.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (file) => {
          await cacheExtensionInfo(file);
        })
      );
    }

    cacheInitialized = true;
    vscode.window.setStatusBarMessage(
      "Extension object info cache initialized",
      3000
    );
  } catch (error) {
    console.error("Error initializing extension info cache:", error);
    vscode.window.showErrorMessage(
      "Failed to initialize extension info cache: " + error.message
    );
  } finally {
    cacheInitializing = false;
  }
}

/**
 * Refresh the extension info cache
 */
function refreshCache() {
  return initializeCache(true);
}

/**
 * Update the cache for a specific file
 * @param {vscode.Uri} uri The file URI to update in the cache
 */
async function updateCacheForFile(uri) {
  try {
    // Remove any existing entries for this file
    removeFromCache(uri);

    // Add new entries
    await cacheObjectInfo(uri);
    await cacheExtensionInfo(uri);
  } catch (error) {
    console.error(`Error updating cache for file ${uri.fsPath}:`, error);
  }
}

/**
 * Remove entries from the cache that belong to a specific file
 * @param {vscode.Uri} uri The file URI to remove from the cache
 */
function removeFromCache(uri) {
  const filePathToRemove = uri.toString();

  // Create a new map excluding entries from this file
  const updatedCache = new Map();
  for (const [key, value] of objectInfoCache.entries()) {
    if (value.uri !== filePathToRemove) {
      updatedCache.set(key, value);
    }
  }

  objectInfoCache = updatedCache;
}

/**
 * Generate a unique cache key for an object
 * @param {string} type Object type
 * @param {string} name Object name
 * @returns {string} Unique cache key
 */
function getCacheKey(type, name) {
  return `${type.toLowerCase()}:${name.toLowerCase()}`;
}

/**
 * Cache information about a regular (non-extension) object
 * @param {vscode.Uri} fileUri The file URI to process
 */
async function cacheObjectInfo(fileUri) {
  try {
    // Read the file content
    const fileContent = await readFileContent(fileUri);
    if (!fileContent) return;

    // Parse the regular object
    const objectInfo = parseRegularObject(fileContent, fileUri);

    if (objectInfo) {
      // Get additional details like fields for tables, controls for pages, etc.
      enrichObjectInfo(objectInfo, fileContent);

      // Use combination of type and name as a key to avoid collisions
      const cacheKey = getCacheKey(objectInfo.type, objectInfo.name);
      objectInfoCache.set(cacheKey, objectInfo);
    }
  } catch (error) {
    console.error(`Error caching object info for ${fileUri.fsPath}:`, error);
  }
}

/**
 * Cache information about extension objects
 * @param {vscode.Uri} fileUri The file URI to process
 */
async function cacheExtensionInfo(fileUri) {
  try {
    // Read the file content
    const fileContent = await readFileContent(fileUri);
    if (!fileContent) return;

    // Parse the extension object
    const extensionInfo = parseExtensionObject(fileContent, fileUri);

    if (extensionInfo) {
      // Determine the base object type from the extension type
      const baseObjectType = extensionInfo.type.replace("extension", "");

      // Look up the extended object information
      const baseObjectKey = getCacheKey(
        baseObjectType,
        extensionInfo.extendsName
      );
      if (objectInfoCache.has(baseObjectKey)) {
        extensionInfo.extendsObject = objectInfoCache.get(baseObjectKey);
      }

      // Use combination of type and name as a key
      const extensionKey = getCacheKey(extensionInfo.type, extensionInfo.name);
      objectInfoCache.set(extensionKey, extensionInfo);

      // Also add to a list of extensions for the base object
      if (objectInfoCache.has(baseObjectKey)) {
        const baseObj = objectInfoCache.get(baseObjectKey);
        if (!baseObj.extensions) {
          baseObj.extensions = [];
        }
        // Avoid duplicate entries
        if (!baseObj.extensions.some((ext) => ext.id === extensionInfo.id)) {
          baseObj.extensions.push(extensionInfo);
        }
      }
    }
  } catch (error) {
    console.error(`Error caching extension info for ${fileUri.fsPath}:`, error);
  }
}

/**
 * Get object information from the cache
 * @param {string} type Object type
 * @param {string} name Object name
 * @returns {object|undefined} Object information
 */
function getObjectInfo(type, name) {
  return objectInfoCache.get(getCacheKey(type, name));
}

/**
 * Check if the cache is initialized
 * @returns {boolean} True if the cache is initialized
 */
function isInitialized() {
  return initialized;
}

/**
 * Check if the cache is currently initializing
 * @returns {boolean} True if the cache is initializing
 */
function isInitializing() {
  return initializing;
}

/**
 * Get statistics about the cache
 * @returns {Object} Cache statistics
 */
function getCacheStats() {
  const stats = {
    initialized,
    initializing,
    lastInitTime,
    objectTypes: {},
  };

  if (objectCache) {
    Object.keys(objectCache).forEach((type) => {
      stats.objectTypes[type] = Object.keys(objectCache[type]).length;
    });
  }

  return stats;
}

/**
 * Initialize the object cache with AL objects from the workspace
 * @returns {Promise<void>}
 */
async function initializeCache() {
  if (initializing) {
    console.log("Cache initialization already in progress");
    return;
  }

  try {
    initializing = true;
    objectCache = {}; // Reset the cache

    const vscode = require("vscode");
    console.log("Starting cache initialization");

    // Find all AL files in the workspace
    const files = await vscode.workspace.findFiles(
      "**/*.al",
      "**/node_modules/**"
    );
    console.log(`Found ${files.length} AL files in workspace`);

    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const content = document.getText();

        // Process tables
        processObjects(content, file.fsPath, "table");

        // Process pages
        processObjects(content, file.fsPath, "page");

        // Process reports
        processObjects(content, file.fsPath, "report");

        // Process codeunits
        processObjects(content, file.fsPath, "codeunit");

        // Process other object types as needed
      } catch (err) {
        console.error(`Error processing file ${file.fsPath}:`, err);
      }
    }

    initialized = true;
    lastInitTime = new Date();
    console.log("Cache initialization complete:", getCacheStats());
  } catch (err) {
    console.error("Failed to initialize cache:", err);
    throw err;
  } finally {
    initializing = false;
  }
}

/**
 * Process AL objects in a file
 * @param {string} content File content
 * @param {string} filePath File path
 * @param {string} objectType Object type to process
 */
function processObjects(content, filePath, objectType) {
  const regex = new RegExp(`${objectType}\\s+(\\d+)\\s+"([^"]+)"`, "gi");
  let match;

  while ((match = regex.exec(content)) !== null) {
    const id = match[1];
    const name = match[2];

    // Create object type cache if it doesn't exist
    if (!objectCache[objectType]) {
      objectCache[objectType] = {};
    }

    const uri = { scheme: "file", path: filePath };

    // Basic object info
    const objectInfo = {
      type: objectType,
      id: id,
      name: name,
      fileName: filePath,
      uri: uri,
    };

    // Add type-specific processing
    if (objectType === "table") {
      // Extract fields for tables
      objectInfo.fields = extractTableFields(content);
    } else if (objectType === "page") {
      // Count controls for pages
      objectInfo.controlsCount = countPageControls(content);
    }

    // Track extensions to this object
    objectInfo.extensions = findExtensions(objectType, name);

    // Store in cache by name (case insensitive)
    objectCache[objectType][name.toLowerCase()] = objectInfo;
  }
}

/**
 * Extract fields from table definition
 * @param {string} content Table AL content
 * @returns {Array} Array of field objects
 */
function extractTableFields(content) {
  const fields = [];
  const fieldRegex = /field\((\d+);\s*"([^"]+)"/gi;
  let match;

  while ((match = fieldRegex.exec(content)) !== null) {
    fields.push({
      id: match[1],
      name: match[2],
    });
  }

  return fields;
}

/**
 * Count controls in a page
 * @param {string} content Page AL content
 * @returns {number} Number of controls
 */
function countPageControls(content) {
  // Simple count of control patterns
  const matches = content.match(/field\s*\(/gi);
  return matches ? matches.length : 0;
}

/**
 * Find extensions for a specific object
 * @param {string} objectType Base object type
 * @param {string} objectName Base object name
 * @returns {Array} Array of extension objects
 */
function findExtensions(objectType, objectName) {
  // This would normally scan for extensions, but for now return empty array
  return [];
}

/**
 * Get the cache key for an object
 * @param {string} objectType Object type
 * @param {string} objectName Object name
 * @returns {string} Cache key
 */
function getCacheKey(objectType, objectName) {
  return objectName.toLowerCase();
}

/**
 * Get information about an object from the cache
 * @param {string} objectType Object type
 * @param {string} objectName Object name
 * @returns {Object|null} Object information or null if not found
 */
function getObjectInfo(objectType, objectName) {
  if (!objectCache[objectType]) {
    console.log(`No objects of type ${objectType} in cache`);
    return null;
  }

  const key = getCacheKey(objectType, objectName);
  return objectCache[objectType][key] || null;
}

module.exports = {
  initializeCache,
  refreshCache,
  updateCacheForFile,
  removeFromCache,
  getCacheKey,
  getObjectInfo,
  isInitialized,
  isInitializing,
  getCacheStats,
};
