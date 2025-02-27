// Assuming this file exists and handles the hover functionality

// ...existing code...

/**
 * Get hover information for an AL object
 * @param {string} objectType
 * @param {string} objectName
 * @param {Object} alObjects
 */
function getHoverInfo(objectType, objectName, alObjects) {
  // ...existing code...

  // Enhanced logging to show where object was found
  if (matchingObject) {
    console.log(
      `Found object ${objectName} in ${matchingObject.source || "workspace"}`
    );
    // If object was loaded from .alpackages, you might want to indicate this in the hover
    if (
      matchingObject.source &&
      matchingObject.source.includes(".alpackages")
    ) {
      markdownContent.appendMarkdown("\n\n*Symbol from .alpackages*");
    }
  }

  // ...existing code...
}

// ...existing code...
