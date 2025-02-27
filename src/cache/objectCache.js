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

module.exports = {
  initializeCache,
  refreshCache,
  updateCacheForFile,
  removeFromCache,
  getCacheKey,
  getObjectInfo,
  isInitialized: () => cacheInitialized,
  isInitializing: () => cacheInitializing,
};
