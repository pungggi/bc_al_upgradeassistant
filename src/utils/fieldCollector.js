const { logger } = require("./logger");

// Cache for table fields by table name
let tableFieldsCache = {};

// Cache for page source tables
let pageSourceTableCache = {};

// Removed extractFieldsFromTableFile (moved to worker)
// Removed extractSourceTableFromPageFile (moved to worker)

/**
 * Get field names for a specific table
 * @param {string} tableName - Name of the table
 * @returns {string[]} - Array of field names (synchronous)
 */
function getFieldsForTable(tableName) {
  // Made synchronous
  if (!tableName) {
    return [];
  }

  // Removed ensureCacheIsUpToDate call

  // Return cached fields if available
  if (tableFieldsCache[tableName]) {
    return tableFieldsCache[tableName];
  }

  return [];
}

// Removed updateFieldsCache (moved to worker)
// Removed ensureCacheIsUpToDate (cache update triggered externally)

/**
 * Get all known tables
 * @returns {string[]} - Array of table names (synchronous)
 */
function getAllKnownTables() {
  // Made synchronous
  // Removed ensureCacheIsUpToDate call
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

  // First check for global variables at the end of the file
  // This is a common pattern in AL where global variables are defined after procedures
  let foundGlobalVar = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    // Look for the variable name in the line
    if (lowerLine.includes(lowerVarName) && lowerLine.includes("record")) {
      foundGlobalVar = true;

      // Extract the table name
      const colonPos = line.indexOf(":");
      if (colonPos !== -1) {
        // Check if variable name is before the colon
        const varPart = line.substring(0, colonPos).trim();
        if (varPart.toLowerCase() === lowerVarName) {
          // Extract text after 'record'
          const afterColon = line.substring(colonPos + 1).trim();
          const recordPos = afterColon.toLowerCase().indexOf("record");
          if (recordPos !== -1) {
            const tableText = afterColon
              .substring(recordPos + "record".length)
              .trim();
            if (tableText) {
              logger.info(
                `[FieldCollector] Found global variable '${variableName}' with table type '${cleanTableName(
                  tableText.split(/[;]/)[0]
                )}'`
              );
              return cleanTableName(tableText.split(/[;]/)[0]);
            }
          }
        }
      }
    }

    // If we've found a global var and processed it, or if we've reached a procedure end,
    // we can stop searching backwards
    if (foundGlobalVar || lowerLine.includes("end;")) {
      break;
    }
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
// Removed findSourceTableFromWorkspace - rely solely on cache now

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

  logger.info(
    `[FieldCollector] Guessing table type for variable: ${variableName}`
  );

  // First try to find it in variable declarations - prioritize this over variable name matching
  const tableFromVar = findTableTypeInVariableDeclarations(
    documentText,
    variableName
  );
  if (tableFromVar) {
    logger.info(
      `[FieldCollector] Found table type '${tableFromVar}' in variable declarations`
    );
    return tableFromVar;
  }

  // Check if the variable name itself is a table name (common pattern in AL)
  // For example, if the variable is "AmagnoSetup", it might be a record of table "AmagnoSetup"
  // This is now a fallback after checking variable declarations
  if (tableFieldsCache[variableName]) {
    logger.info(
      `[FieldCollector] Variable name '${variableName}' matches a known table name`
    );
    return variableName;
  }

  // Try to infer from common naming patterns
  // For example, "CustomerRec" likely refers to "Customer" table
  if (variableName.toLowerCase().endsWith("rec")) {
    const possibleTableName = variableName.substring(
      0,
      variableName.length - 3
    );
    if (tableFieldsCache[possibleTableName]) {
      logger.info(
        `[FieldCollector] Inferred table '${possibleTableName}' from variable name pattern '${variableName}'`
      );
      return possibleTableName;
    }
  }

  // Continue with page-based detection
  // If we're in a page extension, try to find the extended page's source table
  const extendedPage = findExtendedPage(documentText);
  if (extendedPage) {
    // First check our cache
    const sourceTable = findSourceTableForPage(extendedPage);
    if (sourceTable) {
      logger.info(
        `[FieldCollector] Found source table '${sourceTable}' for extended page '${extendedPage}'`
      );
      return sourceTable;
    }
  }

  // Look for SourceTable property in the current document
  const sourceTableMatch = documentText.match(
    /SourceTable\s*=\s*["']([^"']+)["']/i
  );
  if (sourceTableMatch && sourceTableMatch[1]) {
    logger.info(
      `[FieldCollector] Found SourceTable property with value '${sourceTableMatch[1]}'`
    );
    return sourceTableMatch[1];
  }

  // If the variable name is "Rec", try to infer from the object name
  if (variableName.toLowerCase() === "rec") {
    // Try to extract object name from the document
    const objectMatch = documentText.match(
      /\b(page|pageextension|table|tableextension)\s+\d+\s+["']([^"']+)["']/i
    );
    if (objectMatch && objectMatch[2]) {
      const objectName = objectMatch[2];
      // If object name contains the word "Card" or "List", it might be related to a table
      // E.g., "Customer Card" -> "Customer"
      if (objectName.includes("Card") || objectName.includes("List")) {
        const parts = objectName.split(/\s+/);
        if (parts.length > 1) {
          const possibleTableName = parts[0];
          if (tableFieldsCache[possibleTableName]) {
            logger.info(
              `[FieldCollector] Inferred table '${possibleTableName}' from object name '${objectName}'`
            );
            return possibleTableName;
          }
        }
      }
    }
  }

  logger.info(
    `[FieldCollector] Could not determine table type for variable '${variableName}'`
  );
  return null;
}

// Removed updateFieldsCacheForFile and related helpers (logic moved to worker)

/**
 * Sets the in-memory table fields cache. Called by cacheHelper after loading/receiving data.
 * @param {Object} newCache - The new cache object { tableName: [field1, field2,...] }
 */
function setTableFieldsCache(newCache) {
  tableFieldsCache = newCache || {};
  logger.info(
    `[Cache] In-memory table fields cache updated (${
      Object.keys(tableFieldsCache).length
    } tables).`
  );
}

/**
 * Sets the in-memory page source table cache. Called by cacheHelper after loading/receiving data.
 * @param {Object} newCache - The new cache object { pageName: sourceTableName }
 */
function setPageSourceTableCache(newCache) {
  pageSourceTableCache = newCache || {};
  logger.info(
    `[Cache] In-memory page source table cache updated (${
      Object.keys(pageSourceTableCache).length
    } pages).`
  );
}

module.exports = {
  getFieldsForTable, // Getter using in-memory cache
  getAllKnownTables, // Getter using in-memory cache
  setTableFieldsCache, // Setter for in-memory cache
  setPageSourceTableCache, // Setter for in-memory cache
  guessTableType, // Relies on in-memory cache now
  findTableTypeInVariableDeclarations, // Local analysis, unchanged
  findSourceTableForPage, // Getter using in-memory cache
  findExtendedPage, // Local analysis, unchanged
  // Removed exports for functions moved to worker or deleted
};
