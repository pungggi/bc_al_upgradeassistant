const fs = require("fs");
const path = require("path");
const glob = require("glob");
const vscode = require("vscode");

// Cache for table fields by table name
let tableFieldsCache = {};
// Last time the cache was updated
let lastCacheUpdate = 0;
// Cache for page source tables
let pageSourceTableCache = {};

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
 * Parse AL table files to extract field names
 * @param {string} filePath - Path to AL table file
 * @returns {Object|null} - Object with tableName and fields array, or null
 */
function extractFieldsFromTableFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");

    // Skip if not a table definition
    if (!content.includes("table ") && !content.includes("tableextension ")) {
      return null;
    }

    // Extract table name
    let tableName = null;
    let tableMatch = content.match(/table\s+(\d+)\s+["']([^"']+)["']/i);

    if (tableMatch) {
      tableName = tableMatch[2];
    } else {
      // Try tableextension
      tableMatch = content.match(
        /tableextension\s+(\d+)\s+["']([^"']+)["']\s+extends\s+["']([^"']+)["']/i
      );
      if (tableMatch) {
        tableName = tableMatch[3]; // Use the base table name
      }
    }

    if (!tableName) {
      return null;
    }

    // Extract field definitions
    const fields = [];

    // Match field definitions
    const fieldRegex = /field\s*\(\s*\d+\s*;\s*["']([^"']+)["']/gi;
    let match;
    while ((match = fieldRegex.exec(content)) !== null) {
      fields.push(match[1]);
    }

    return { tableName, fields };
  } catch (error) {
    console.error(`Error extracting fields from ${filePath}:`, error);
    return null;
  }
}

/**
 * Parse AL page files to extract source table
 * @param {string} filePath - Path to AL page file
 * @returns {Object|null} - Object with pageName and sourceTable, or null
 */
function extractSourceTableFromPageFile(filePath) {
  if (!filePath.endsWith(".al")) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");

    // Skip if not a page definition
    if (!content.includes("page ")) {
      return null;
    }

    // Extract page name
    const pageMatch = content.match(/page\s+(\d+)\s+["']([^"']+)["']/i);
    if (!pageMatch) {
      return null;
    }

    const pageName = pageMatch[2];

    // Extract source table
    const sourceTableMatch = content.match(
      /SourceTable\s*=\s*["']([^"']+)["']/i
    );
    if (!sourceTableMatch) {
      return null;
    }

    return {
      pageName,
      sourceTable: sourceTableMatch[1],
    };
  } catch (error) {
    console.error(`Error extracting source table from ${filePath}:`, error);
    return null;
  }
}

/**
 * Get field names for a specific table
 * @param {string} tableName - Name of the table
 * @returns {Promise<string[]>} - Array of field names
 */
async function getFieldsForTable(tableName) {
  if (!tableName) {
    return [];
  }

  // Check if we need to refresh the cache
  await ensureCacheIsUpToDate();

  // Return cached fields if available
  if (tableFieldsCache[tableName]) {
    return tableFieldsCache[tableName];
  }

  return [];
}

/**
 * Update the fields cache from source files
 * @returns {Promise<void>}
 */
async function updateFieldsCache() {
  // Get source extraction path from settings
  const srcPath = getConfigValue("srcExtractionPath", "");
  if (!srcPath) {
    console.warn("Source extraction path not configured");
    return;
  }

  try {
    // Find all AL files
    const alFiles = glob.sync(path.join(srcPath, "**", "*.al"));
    console.log(`Found ${alFiles.length} .al files in ${srcPath}`);
    // Reset caches
    tableFieldsCache = {};
    pageSourceTableCache = {};

    // Process each file
    for (const filePath of alFiles) {
      // Process table and tableextension files
      const tableResult = extractFieldsFromTableFile(filePath);
      if (tableResult && tableResult.tableName && tableResult.fields.length) {
        // If table already in cache, combine the fields
        if (tableFieldsCache[tableResult.tableName]) {
          tableFieldsCache[tableResult.tableName] = [
            ...new Set([
              ...tableFieldsCache[tableResult.tableName],
              ...tableResult.fields,
            ]),
          ];
        } else {
          // This is the correct 'else' for when the table is new
          tableFieldsCache[tableResult.tableName] = tableResult.fields;
        }
      }

      // Process page files for source tables
      const pageResult = extractSourceTableFromPageFile(filePath);
      if (pageResult && pageResult.pageName && pageResult.sourceTable) {
        pageSourceTableCache[pageResult.pageName] = pageResult.sourceTable;
      }
    }

    lastCacheUpdate = Date.now();
    const tableCount = Object.keys(tableFieldsCache).length;
    const pageCount = Object.keys(pageSourceTableCache).length;
    console.log(
      // Log the final counts
      `Finished updating fields cache. Tables: ${tableCount}, Pages: ${pageCount}`
    );
    // Optional: Uncomment to log all cached tables for deeper debugging
    // if (tableCount > 0) {
    //   console.log("Cached tables:", Object.keys(tableFieldsCache));
    // }
  } catch (error) {
    console.error("Error updating fields cache:", error);
  }
}

/**
 * Ensure the fields cache is up-to-date
 * @returns {Promise<void>}
 */
async function ensureCacheIsUpToDate() {
  // Get cache timeout from settings (in seconds)
  const cacheTimeout =
    getConfigValue("fieldSuggestion.cacheTimeout", 600) * 1000;

  if (Date.now() - lastCacheUpdate > cacheTimeout) {
    await updateFieldsCache();
  }
}

/**
 * Get all known tables
 * @returns {Promise<string[]>} - Array of table names
 */
async function getAllKnownTables() {
  await ensureCacheIsUpToDate();
  return Object.keys(tableFieldsCache);
}

/**
 * Find extended page source from a page extension
 * @param {string} documentText - Document content
 * @returns {string|null} - Extended page name or null if not found
 */
function findExtendedPage(documentText) {
  if (!documentText) {
    return null;
  }

  // Look for pageextension definition: pageextension 50001 "MyExtension" extends "Customer Card"
  const extensionMatch = documentText.match(
    /pageextension\s+\d+\s+["'][^"']+["']\s+extends\s+["']([^"']+)["']/i
  );

  if (extensionMatch && extensionMatch[1]) {
    return extensionMatch[1];
  }

  return null;
}

/**
 * Find source table for a page by its name
 * @param {string} pageName - Name of the page
 * @returns {string|null} - Source table name or null if not found
 */
function findSourceTableForPage(pageName) {
  if (!pageName || !pageSourceTableCache[pageName]) {
    return null;
  }

  return pageSourceTableCache[pageName];
}

/**
 * Find the source table for a record variable by analyzing variable declarations
 * @param {string} documentText - Document content
 * @param {string} variableName - Record variable name
 * @returns {string|null} - Table name or null if not found
 */
function findTableTypeInVariableDeclarations(documentText, variableName) {
  if (!documentText || !variableName) return null;

  const lines = documentText.split(/\r?\n/);
  const lowerVarName = variableName.toLowerCase();

  // Helper to extract table name from a token (removes quotes)
  function cleanTableName(token) {
    let name = token.trim();
    if (name.startsWith('"') && name.endsWith('"')) {
      name = name.substring(1, name.length - 1);
    }
    return name;
  }

  // Process variable declarations (var sections)
  let inVarSection = false;
  for (const line of lines) {
    const lowerLine = line.toLowerCase();

    // Check for var section start/end
    if (lowerLine.trim() === "var") {
      inVarSection = true;
      continue;
    } else if (inVarSection && lowerLine.trim() === "begin") {
      inVarSection = false;
      continue;
    }

    // Process declarations in var section
    if (
      inVarSection &&
      lowerLine.includes(lowerVarName) &&
      lowerLine.includes("record")
    ) {
      const colonPos = line.indexOf(":");
      if (colonPos !== -1) {
        // Check if variable name is before the colon
        const varPart = line.substring(0, colonPos).trim();
        if (varPart.toLowerCase().includes(lowerVarName)) {
          // Extract text after 'record'
          const afterColon = line.substring(colonPos + 1).trim();
          const recordPos = afterColon.toLowerCase().indexOf("record");
          if (recordPos !== -1) {
            const tableText = afterColon
              .substring(recordPos + "record".length)
              .trim();
            if (tableText) {
              return cleanTableName(tableText.split(/[;]/)[0]);
            }
          }
        }
      }
    }
  }

  // Look for 'var variableName: Record ...' (single line declaration)
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (
      !lowerLine.includes("var") ||
      !lowerLine.includes(lowerVarName) ||
      !lowerLine.includes("record")
    ) {
      continue;
    }

    const parts = line.split(/[:;]/);
    if (parts.length < 2) continue;

    // Try to locate the 'Record' part
    for (let i = 0; i < parts.length; i++) {
      if (
        parts[i].toLowerCase().includes(lowerVarName) &&
        i + 1 < parts.length
      ) {
        const recordPart = parts[i + 1].trim();
        if (recordPart.toLowerCase().startsWith("record")) {
          const afterRecord = recordPart
            .substring(
              recordPart.toLowerCase().indexOf("record") + "record".length
            )
            .trim();
          if (afterRecord) {
            return cleanTableName(afterRecord);
          }
        }
      }
    }
  }

  // Look for procedure parameters 'MyProcedure(variableName: Record ...)'
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (!lowerLine.includes(lowerVarName) || !lowerLine.includes("record")) {
      continue;
    }

    // Check for parameter declaration format
    const paramPattern = new RegExp(`${lowerVarName}\\s*:\\s*record`, "i");
    if (!paramPattern.test(lowerLine)) continue;

    const start = line.indexOf(variableName + ":");
    if (start === -1) {
      // Try with spaces
      const altStart = line.indexOf(variableName + " :");
      if (altStart === -1) continue;
    }

    // Extract text after 'variableName:'
    const afterVar = line.substring(
      line.toLowerCase().indexOf(lowerVarName) + lowerVarName.length
    );
    const colonPos = afterVar.indexOf(":");
    if (colonPos === -1) continue;

    const afterColon = afterVar.substring(colonPos + 1).trim();
    const recordPos = afterColon.toLowerCase().indexOf("record");
    if (recordPos === -1) continue;

    const tableText = afterColon.substring(recordPos + "record".length).trim();
    if (tableText) {
      // Handle cases where table name might be followed by other tokens
      const endPos = Math.min(
        tableText.indexOf(")") !== -1 ? tableText.indexOf(")") : Infinity,
        tableText.indexOf(";") !== -1 ? tableText.indexOf(";") : Infinity,
        tableText.indexOf(",") !== -1 ? tableText.indexOf(",") : Infinity
      );

      return cleanTableName(
        endPos !== Infinity ? tableText.substring(0, endPos) : tableText
      );
    }
  }

  return null;
}

/**
 * Search for page files in the workspace to find a page by name
 * @param {string} pageName - The name of the page to find
 * @returns {Promise<string|null>} - Source table name or null if not found
 */
async function findSourceTableFromWorkspace(pageName) {
  if (!pageName) {
    return null;
  }

  try {
    // Search in all workspace files
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return null;
    }

    // First check the cache
    if (pageSourceTableCache[pageName]) {
      return pageSourceTableCache[pageName];
    }

    // Find all page files in the workspace
    const pageFiles = await vscode.workspace.findFiles(
      "**/*.al",
      "**/node_modules/**"
    );

    // Process files to find matching page
    for (const file of pageFiles) {
      try {
        const content = await vscode.workspace.fs.readFile(file);
        const text = Buffer.from(content).toString("utf8");

        // Skip if not a page definition
        if (!text.includes("page ")) {
          continue;
        }

        // Check if this is the page we're looking for
        const pageMatch = text.match(/page\s+\d+\s+["']([^"']+)["']/i);
        if (pageMatch && pageMatch[1] === pageName) {
          // Find the source table
          const sourceTableMatch = text.match(
            /SourceTable\s*=\s*["']([^"']+)["']/i
          );
          if (sourceTableMatch && sourceTableMatch[1]) {
            // Cache the result
            pageSourceTableCache[pageName] = sourceTableMatch[1];
            return sourceTableMatch[1];
          }
        }
      } catch (error) {
        // Continue to next file
        console.error(`Error reading file ${file.fsPath}:`, error);
      }
    }
  } catch (error) {
    console.error(`Error finding source table for page ${pageName}:`, error);
  }

  return null;
}

/**
 * Guess the table type for a variable with improved detection
 * @param {string} documentText - Document content
 * @param {string} variableName - Variable name to find
 * @returns {Promise<string|null>} - Table name or null if not found
 */
async function guessTableType(documentText, variableName) {
  if (!documentText || !variableName) {
    return null;
  }

  // First try to find it in variable declarations
  const tableFromVar = findTableTypeInVariableDeclarations(
    documentText,
    variableName
  );
  if (tableFromVar) {
    return tableFromVar;
  }

  // Only continue with page-based detection if variable name is "Rec"
  // or couldn't be found in variable declarations
  if (variableName.toLowerCase() === "rec" || !tableFromVar) {
    // If we're in a page extension, try to find the extended page's source table
    const extendedPage = findExtendedPage(documentText);
    if (extendedPage) {
      // First check our cache
      const sourceTable = findSourceTableForPage(extendedPage);
      if (sourceTable) {
        return sourceTable;
      }

      // If not in cache, search workspace
      const workspaceSourceTable = await findSourceTableFromWorkspace(
        extendedPage
      );
      if (workspaceSourceTable) {
        return workspaceSourceTable;
      }
    }

    // As a last resort, look for SourceTable property in the current document
    const sourceTableMatch = documentText.match(
      /SourceTable\s*=\s*["']([^"']+)["']/i
    );
    if (sourceTableMatch && sourceTableMatch[1]) {
      return sourceTableMatch[1];
    }
  }

  return null;
}

/**
 * Update the fields cache for a single file
 * @param {string} filePath - Path to the AL file
 * @param {string} fileContent - Content of the file
 * @returns {boolean} - True if the cache was updated
 */
function updateFieldsCacheForFile(filePath, fileContent) {
  if (!filePath || !fileContent) {
    return false;
  }

  let updated = false;

  try {
    // For tables, extract fields and update cache
    const tableResult = extractFieldsFromTable(fileContent);
    if (tableResult && tableResult.tableName && tableResult.fields.length) {
      // If table already in cache, combine the fields
      if (tableFieldsCache[tableResult.tableName]) {
        tableFieldsCache[tableResult.tableName] = [
          ...new Set([
            ...tableFieldsCache[tableResult.tableName],
            ...tableResult.fields,
          ]),
        ];
      } else {
        tableFieldsCache[tableResult.tableName] = tableResult.fields;
      }
      updated = true;
    }

    // For pages, extract source table and update cache
    const pageResult = extractSourceTableFromPage(fileContent);
    if (pageResult && pageResult.pageName && pageResult.sourceTable) {
      pageSourceTableCache[pageResult.pageName] = pageResult.sourceTable;
      updated = true;
    }

    if (updated) {
      lastCacheUpdate = Date.now();
      console.log(`Updated fields cache for file: ${path.basename(filePath)}`);
    }

    return updated;
  } catch (error) {
    console.error(`Error updating fields cache for ${filePath}:`, error);
    return false;
  }
}

/**
 * Extract fields from table content
 * @param {string} content - Content of the AL file
 * @returns {Object|null} - Object with tableName and fields array, or null
 */
function extractFieldsFromTable(content) {
  // Skip if not a table definition
  if (!content.includes("table ") && !content.includes("tableextension ")) {
    return null;
  }

  // Extract table name
  let tableName = null;
  let tableMatch = content.match(/table\s+(\d+)\s+["']([^"']+)["']/i);

  if (tableMatch) {
    tableName = tableMatch[2];
  } else {
    // Try tableextension
    tableMatch = content.match(
      /tableextension\s+(\d+)\s+["']([^"']+)["']\s+extends\s+["']([^"']+)["']/i
    );
    if (tableMatch) {
      tableName = tableMatch[3]; // Use the base table name
    }
  }

  if (!tableName) {
    return null;
  }

  // Extract field definitions
  const fields = [];

  // Match field definitions
  const fieldRegex = /field\s*\(\s*\d+\s*;\s*["']([^"']+)["']/gi;
  let match;
  while ((match = fieldRegex.exec(content)) !== null) {
    fields.push(match[1]);
  }

  return { tableName, fields };
}

/**
 * Extract source table from page content
 * @param {string} content - Content of the AL file
 * @returns {Object|null} - Object with pageName and sourceTable, or null
 */
function extractSourceTableFromPage(content) {
  // Skip if not a page definition
  if (!content.includes("page ")) {
    return null;
  }

  // Extract page name
  const pageMatch = content.match(/page\s+(\d+)\s+["']([^"']+)["']/i);
  if (!pageMatch) {
    return null;
  }

  const pageName = pageMatch[2];

  // Extract source table
  const sourceTableMatch = content.match(/SourceTable\s*=\s*["']([^"']+)["']/i);
  if (!sourceTableMatch) {
    return null;
  }

  return {
    pageName,
    sourceTable: sourceTableMatch[1],
  };
}

module.exports = {
  getFieldsForTable,
  updateFieldsCache,
  updateFieldsCacheForFile, // Export the new function
  ensureCacheIsUpToDate,
  getAllKnownTables,
  guessTableType,
  findTableTypeInVariableDeclarations,
  findSourceTableForPage,
  findExtendedPage,
  findSourceTableFromWorkspace,
};
