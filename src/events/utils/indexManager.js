const fs = require("fs");
const path = require("path");
const configManager = require("../../utils/configManager");
const { updateMigrationReferences } = require("../../utils/migrationHelper");

function updateIndexAfterObjectChange(filePath, oldContent, newContent) {
  if (!filePath || !oldContent || !newContent) {
    return;
  }

  const objectTypeRegex =
    /\b(table|tableextension|page|pageextension|report|reportextension|codeunit|query|xmlport|enum|enumextension|profile|interface)\b\s+(\d+)\s+["']([^"']+)["']/i;
  const oldObjectMatch = oldContent.match(objectTypeRegex);
  const newObjectMatch = newContent.match(objectTypeRegex);

  if (!oldObjectMatch || !newObjectMatch) {
    console.warn("Could not extract object information for index update");
    return;
  }

  const oldType = oldObjectMatch[1].toLowerCase();
  const oldNumber = oldObjectMatch[2];
  const newType = newObjectMatch[1].toLowerCase();
  const newNumber = newObjectMatch[2];

  const upgradedObjectFolders = configManager.getConfigValue(
    "upgradedObjectFolders",
    null
  );
  if (!upgradedObjectFolders?.basePath) return;

  const indexPath = path.join(upgradedObjectFolders.basePath, ".index");
  const oldObjectTypeFolder = path.join(indexPath, oldType);
  const oldObjectNumberFolder = path.join(oldObjectTypeFolder, oldNumber);
  const oldInfoFilePath = path.join(oldObjectNumberFolder, "info.json");

  if (fs.existsSync(oldInfoFilePath)) {
    const infoData = JSON.parse(fs.readFileSync(oldInfoFilePath, "utf8"));
    const newObjectTypeFolder = path.join(indexPath, newType);
    const newObjectNumberFolder = path.join(newObjectTypeFolder, newNumber);

    fs.mkdirSync(newObjectTypeFolder, { recursive: true });
    fs.mkdirSync(newObjectNumberFolder, { recursive: true });

    const updatedInfo = {
      ...infoData,
      originalPath: filePath,
      objectType: newType,
      objectNumber: newNumber,
      lastUpdated: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(newObjectNumberFolder, "info.json"),
      JSON.stringify(updatedInfo, null, 2),
      "utf8"
    );

    if (oldType !== newType || oldNumber !== newNumber) {
      updateMigrationReferences(
        indexPath,
        updatedInfo.referencedMigrationFiles || [],
        oldType,
        oldNumber,
        newType,
        newNumber
      );

      try {
        fs.unlinkSync(oldInfoFilePath);
        if (fs.readdirSync(oldObjectNumberFolder).length === 0) {
          fs.rmdirSync(oldObjectNumberFolder);
        }
        if (fs.readdirSync(oldObjectTypeFolder).length === 0) {
          fs.rmdirSync(oldObjectTypeFolder);
        }
      } catch (error) {
        console.error("Error cleaning up old index files:", error);
      }
    }

    return updatedInfo;
  }

  const newObjectTypeFolder = path.join(indexPath, newType);
  const newObjectNumberFolder = path.join(newObjectTypeFolder, newNumber);
  fs.mkdirSync(newObjectTypeFolder, { recursive: true });
  fs.mkdirSync(newObjectNumberFolder, { recursive: true });

  const newInfo = {
    objectType: newType,
    objectNumber: newNumber,
    indexedAt: new Date().toISOString(),
    referencedMigrationFiles: [],
  };

  fs.writeFileSync(
    path.join(newObjectNumberFolder, "info.json"),
    JSON.stringify(newInfo, null, 2),
    "utf8"
  );

  return newInfo;
}

module.exports = {
  updateIndexAfterObjectChange,
};
