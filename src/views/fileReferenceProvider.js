const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const documentationHelper = require("../utils/documentationHelper");

/**
 * Tree data provider for BC/AL file references
 */
class FileReferenceProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Store expanded state
    this.expandedState = new Map();

    // Load expanded state from storage
    this.storageLoaded = false;
    this.extensionContext = null;

    // Listen for file change events
    this.disposable = vscode.window.onDidChangeActiveTextEditor((editor) =>
      this._onActiveEditorChanged(editor)
    );

    // Store current editor
    this.activeEditor = vscode.window.activeTextEditor;

    // Load documentation IDs from settings
    this.configManager = require("../utils/configManager");
    this.documentationIds = this.configManager.getMergedDocumentationIds();

    // Also listen for configuration changes to reload IDs
    this.configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("bc-al-upgradeassistant.documentationIds")) {
        this.documentationIds = this.configManager.getMergedDocumentationIds();
        this.refresh();
      }
    });

    // Create decoration type for done references with more prominent styling
    this.doneDecorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: path.join(__dirname, "..", "..", "media", "check.svg"),
      gutterIconSize: "100%",
      fontWeight: "normal",
      isWholeLine: true,
      // before: {
      //   contentText: "✓",
      //   color: new vscode.ThemeColor("editorGutter.addedBackground"),
      //   margin: "0 0 0 0",
      // },
    });

    // Create decoration type for undone references
    this.undoneDecorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: path.join(
        __dirname,
        "..",
        "..",
        "media",
        "unchecked.svg"
      ),
      gutterIconSize: "100%",
      fontWeight: "bold",
      isWholeLine: true,
    });

    // Create decoration type for not implemented references
    this.notImplementedDecorationType =
      vscode.window.createTextEditorDecorationType({
        gutterIconPath: path.join(
          __dirname,
          "..",
          "..",
          "media",
          "not-implemented.svg"
        ),
        gutterIconSize: "100%",
        fontWeight: "normal",
        isWholeLine: true,
        opacity: "0.7",
      });

    // Track current editor
    this.currentEditor = vscode.window.activeTextEditor;

    // Listen for editor changes to update decorations
    this.editorChangeDisposable = [
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.currentEditor = editor;
        if (editor) {
          this.updateDecorations();
        }
      }),
      // Add listener for document changes
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          this.currentEditor &&
          event.document === this.currentEditor.document
        ) {
          this.updateDecorations();
        }
      }),
      // Add listener for when text editor is opened
      vscode.window.onDidChangeVisibleTextEditors(() => {
        if (this.currentEditor) {
          this.updateDecorations();
        }
      }),
    ];

    // Initial decoration update
    if (this.currentEditor) {
      this.updateDecorations();
    }
  }

  /**
   * Initialize with extension context for storage
   * @param {vscode.ExtensionContext} context Extension context
   */
  initialize(context) {
    this.extensionContext = context;
    this.loadExpandedState();
  }

  /**
   * Load expanded state from storage
   */
  loadExpandedState() {
    if (!this.extensionContext) return;

    try {
      const state = this.extensionContext.globalState.get(
        "treeViewExpandedState"
      );
      if (state && Array.isArray(state)) {
        this.expandedState.clear();
        state.forEach((id) => this.expandedState.set(id, true));
      }
      this.storageLoaded = true;
      console.log(`Loaded ${this.expandedState.size} expanded tree items`);
    } catch (error) {
      console.error("Error loading expanded state:", error);
    }
  }

  /**
   * Save expanded state to storage
   */
  saveExpandedState() {
    if (!this.extensionContext) return;

    try {
      // Convert Map keys of expanded items to array
      const expandedItems = Array.from(this.expandedState.entries())
        .filter(([, isExpanded]) => isExpanded)
        .map(([id]) => id);

      this.extensionContext.globalState.update(
        "treeViewExpandedState",
        expandedItems
      );
      console.log(`Saved ${expandedItems.length} expanded tree items`);
    } catch (error) {
      console.error("Error saving expanded state:", error);
    }
  }

  /**
   * Handle active editor changes
   * @param {vscode.TextEditor} editor The new active editor
   */
  _onActiveEditorChanged(editor) {
    this.activeEditor = editor;
    this._onDidChangeTreeData.fire(null);
  }

  /**
   * Refresh the tree view
   */
  refresh() {
    this._onDidChangeTreeData.fire(null);
  }

  /**
   * Get children for the tree view
   * @param {TreeItem} element The parent element
   * @returns {Promise<TreeItem[]>} The child elements
   */
  async getChildren(element) {
    // If no active editor, show placeholder
    if (!this.activeEditor) {
      return [new NoFileItem()];
    }

    // If we have a parent element, get its children
    if (element) {
      return element.getChildren();
    }

    // Root elements are based on the current file
    const filePath = this.activeEditor.document.uri.fsPath;
    const fileExt = path.extname(filePath).toLowerCase();

    if (fileExt === ".txt") {
      return this._getTxtFileReferences(filePath);
    } else if (fileExt === ".al") {
      return this._getAlFileReferences(filePath);
    } else {
      return [new UnsupportedFileItem()];
    }
  }

  /**
   * Get tree item for element
   * @param {TreeItem} element The element
   * @returns {vscode.TreeItem} The tree item
   */
  getTreeItem(element) {
    // Check if we have stored state for this element and it should be expanded
    if (
      element.id &&
      element.collapsibleState !== vscode.TreeItemCollapsibleState.None
    ) {
      const isExpanded = this.expandedState.get(element.id);
      if (isExpanded !== undefined) {
        element.collapsibleState = isExpanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed;
      }
    }
    return element;
  }

  /**
   * Save expanded state for an item
   * @param {string} itemId ID of the item
   * @param {boolean} isExpanded Whether the item is expanded
   */
  setItemExpandedState(itemId, isExpanded) {
    if (!itemId) return;

    this.expandedState.set(itemId, isExpanded);
    this.saveExpandedState();
  }

  /**
   * Get references for a .txt file (original C/AL file)
   * @param {string} filePath Path to the .txt file
   * @returns {Promise<TreeItem[]>} Tree items
   */
  async _getTxtFileReferences(filePath) {
    try {
      // Find the .index folder
      const indexFolder = this._findIndexFolder();
      if (!indexFolder) {
        return [
          new TreeItem(
            "No index folder found",
            vscode.TreeItemCollapsibleState.None
          ),
        ];
      }

      // Look for reference file in the index folder
      const fileName = path.basename(filePath);
      const referenceFileName = fileName.replace(/\.txt$/, ".json");
      const referenceFilePath = path.join(indexFolder, referenceFileName);

      const result = [];

      // Read file content and look for documentation IDs
      const fileContent = fs.readFileSync(filePath, "utf8");
      const documentationRefs = this._findDocumentationReferences(
        fileContent,
        filePath
      );

      if (documentationRefs.length > 0) {
        result.push(new DocumentationRefsItem(documentationRefs, filePath));
      }

      if (!fs.existsSync(referenceFilePath)) {
        if (result.length === 0) {
          result.push(
            new TreeItem(
              "No references found for this file",
              vscode.TreeItemCollapsibleState.None
            )
          );
        }
        this.updateDecorations();
        return result;
      }

      // Read and parse the reference file
      const referenceData = JSON.parse(
        fs.readFileSync(referenceFilePath, "utf8")
      );
      if (
        referenceData.referencedWorkingObjects &&
        referenceData.referencedWorkingObjects.length > 0
      ) {
        // Create tree items for each referenced object
        const referencedObjects = referenceData.referencedWorkingObjects.map(
          (ref) => {
            return new ReferencedObjectItem(ref.type, ref.number, indexFolder);
          }
        );

        result.push(new ReferencedObjectsGroup(referencedObjects));
      } else if (result.length === 0) {
        result.push(
          new TreeItem(
            "No referenced objects found",
            vscode.TreeItemCollapsibleState.None
          )
        );
      }

      this.updateDecorations();
      return result;
    } catch (error) {
      console.error("Error getting .txt file references:", error);
      return [
        new TreeItem(
          `Error: ${error.message}`,
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    }
  }

  /**
   * Get references for an AL file
   * @param {string} filePath Path to the AL file
   * @returns {Promise<TreeItem[]>} Tree items
   */
  async _getAlFileReferences(filePath) {
    try {
      // Extract object info from AL file
      const objectInfo = this._extractAlObjectInfo(filePath);
      if (!objectInfo) {
        return [
          new TreeItem(
            "Not a valid AL object file",
            vscode.TreeItemCollapsibleState.None
          ),
        ];
      }

      const result = [
        // new InfoItem("Object Type", objectInfo.type),
        // new InfoItem("Object ID", objectInfo.id),
        // new InfoItem("Object Name", objectInfo.name),
      ];

      // Find the .index folder
      const indexFolder = this._findIndexFolder();
      if (!indexFolder) {
        return result;
      }

      // Look for info.json in the object's index folder
      const objectFolder = path.join(
        indexFolder,
        objectInfo.type.toLowerCase(),
        objectInfo.id
      );
      const infoFilePath = path.join(objectFolder, "info.json");

      if (!fs.existsSync(infoFilePath)) {
        return result;
      }

      // Read and parse the info file
      const infoData = JSON.parse(fs.readFileSync(infoFilePath, "utf8"));

      if (infoData.indexedAt) {
        result.push(
          new InfoItem(
            "Indexed At",
            new Date(infoData.indexedAt).toLocaleString()
          )
        );
      }

      // Check for migration files
      if (
        infoData.referencedMigrationFiles &&
        infoData.referencedMigrationFiles.length > 0
      ) {
        // Add referenced migration files group
        const migrationFiles = infoData.referencedMigrationFiles;

        // For each migration file, scan for documentation IDs
        const migrationFileRefs = [];

        for (const migFile of migrationFiles) {
          if (fs.existsSync(migFile)) {
            const content = fs.readFileSync(migFile, "utf8");
            const docRefs = this._findDocumentationReferences(content, migFile);
            if (docRefs.length > 0) {
              migrationFileRefs.push({
                file: migFile,
                refs: docRefs,
              });
            }
          }
        }

        // Create migration files node with documentation references
        result.push(
          new EnhancedMigrationFilesItem(migrationFiles, migrationFileRefs)
        );
      }

      return result;
    } catch (error) {
      console.error("Error getting AL file references:", error);
      return [
        new TreeItem(
          `Error: ${error.message}`,
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    }
  }

  /**
   * Find the .index folder path
   * @returns {string|null} Path to the .index folder or null if not found
   */
  _findIndexFolder() {
    const configManager = require("../utils/configManager");
    const upgradedObjectFolders = configManager.getConfigValue(
      "upgradedObjectFolders",
      null
    );

    if (upgradedObjectFolders && upgradedObjectFolders.basePath) {
      const indexPath = path.join(upgradedObjectFolders.basePath, ".index");
      if (fs.existsSync(indexPath)) {
        return indexPath;
      }
    }

    // Try to find it in workspace folders
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const potentialPath = path.join(folder.uri.fsPath, ".index");
        if (fs.existsSync(potentialPath)) {
          return potentialPath;
        }
      }
    }

    return null;
  }

  /**
   * Extract AL object info from file content
   * @param {string} filePath Path to the AL file
   * @returns {{type: string, id: string, name: string}|null} Object info or null
   */
  _extractAlObjectInfo(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");

      // Look for object declaration
      const patterns = [
        // tableextension, pageextension, etc.
        /\b(tableextension|pageextension|reportextension|codeunitextension)\s+(\d+)\s+["']([^"']+)["']/i,
        // table, page, report, codeunit, etc.
        /\b(table|page|report|codeunit|query|xmlport|enum|profile|interface)\s+(\d+)\s+["']([^"']+)["']/i,
        // permissionset
        /\b(permissionset)\s+(\w+)\s+/i,
      ];

      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
          return {
            type: match[1],
            id: match[2],
            name: match[3] || match[2], // For permissionsets with no numeric ID
          };
        }
      }

      return null;
    } catch (error) {
      console.error("Error extracting AL object info:", error);
      return null;
    }
  }

  /**
   * Find documentation references in file content
   * @param {string} content The file content
   * @param {string} filePath Path to the file
   * @returns {Array<{id: string, lineNumber: number, description: string, done: boolean, notImplemented: boolean}>} Documentation references Documentation references
   */
  _findDocumentationReferences(content, filePath) {
    if (!content) {
      return [];
    }

    // Create regex pattern from documentation IDs
    const { idMap, regex } = documentationHelper.createDocumentationRegex(
      this.documentationIds
    );
    if (!regex) {
      console.log("No documentation IDs configured");
      return [];
    }

    // Debug output of available documentation IDs
    console.log("Available documentation IDs:", Object.keys(idMap));

    // Find references
    const docRefs = documentationHelper.findDocumentationReferences(
      content,
      regex,
      idMap,
      filePath
    );

    // Enhance with "done" status from storage
    docRefs.forEach((ref) => {
      const refData = this._getDocumentationReferenceData(
        filePath,
        ref.id,
        ref.lineNumber
      );
      ref.done = refData ? refData.done : false;
      ref.notImplemented = refData ? refData.notImplemented : false;
      ref.userDescription = refData ? refData.userDescription : "";
    });

    console.log(
      `Found ${docRefs.length} documentation references in ${path.basename(
        filePath
      )}`
    );

    return docRefs;
  }

  /**
   * Get stored data for a documentation reference
   * @param {string} filePath File path
   * @param {string} id Documentation ID
   * @param {number} lineNumber Line number
   * @returns {any} Stored reference data or null
   */
  _getDocumentationReferenceData(filePath, id, lineNumber) {
    try {
      const storageFile = this._getDocumentationStorageFile();
      if (!fs.existsSync(storageFile)) {
        return null;
      }

      const storageData = JSON.parse(fs.readFileSync(storageFile, "utf8"));
      const fileKey = this._normalizePathForStorage(filePath);

      if (storageData[fileKey] && storageData[fileKey].references) {
        return storageData[fileKey].references.find(
          (ref) => ref.id === id && ref.lineNumber === lineNumber
        );
      }

      return null;
    } catch (error) {
      console.error("Error reading documentation reference data:", error);
      return null;
    }
  }

  /**
   * Normalize a file path for storage as a key
   * @param {string} filePath File path
   * @returns {string} Normalized path
   */
  _normalizePathForStorage(filePath) {
    return documentationHelper.normalizePathForStorage(filePath);
  }

  /**
   * Get path to documentation references storage file
   * @returns {string} Path to storage file
   */
  _getDocumentationStorageFile() {
    return documentationHelper.getDocumentationStorageFile(() =>
      this._findIndexFolder()
    );
  }

  /**
   * Toggle the "done" state of a documentation reference
   * @param {string} filePath File path
   * @param {string} id Documentation ID
   * @param {number} lineNumber Line number
   * @returns {boolean} New "done" state
   */
  toggleDocumentationReferenceDone(filePath, id, lineNumber) {
    const result = (() => {
      try {
        const storageFile = this._getDocumentationStorageFile();

        // Read existing data or create new
        let storageData = {};
        if (fs.existsSync(storageFile)) {
          storageData = JSON.parse(fs.readFileSync(storageFile, "utf8"));
        }

        const fileKey = this._normalizePathForStorage(filePath);

        // Initialize file entry if needed
        if (!storageData[fileKey]) {
          storageData[fileKey] = {
            references: [],
          };
        }

        // Find existing reference or add new one
        let ref = storageData[fileKey].references.find(
          (r) => r.id === id && r.lineNumber === lineNumber
        );

        if (ref) {
          // Toggle state
          ref.done = !ref.done;
        } else {
          // Add new entry
          ref = { id, lineNumber, done: true };
          storageData[fileKey].references.push(ref);
        }

        // Save updated data
        fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

        // Fire change event to refresh tree
        this.refresh();

        return ref.done;
      } catch (error) {
        console.error("Error toggling documentation reference state:", error);
        return false;
      }
    })();

    // Update decorations after toggling
    this.updateDecorations();

    return result;
  }

  /**
   * Toggle the "not implemented" state of a documentation reference
   * @param {string} filePath File path
   * @param {string} id Documentation ID
   * @param {number} lineNumber Line number
   * @returns {boolean} New "not implemented" state
   */
  toggleDocumentationReferenceNotImplemented(filePath, id, lineNumber) {
    const result = (() => {
      try {
        const storageFile = this._getDocumentationStorageFile();

        // Read existing data or create new
        let storageData = {};
        if (fs.existsSync(storageFile)) {
          storageData = JSON.parse(fs.readFileSync(storageFile, "utf8"));
        }

        const fileKey = this._normalizePathForStorage(filePath);

        // Initialize file entry if needed
        if (!storageData[fileKey]) {
          storageData[fileKey] = {
            references: [],
          };
        }

        // Find existing reference or add new one
        let ref = storageData[fileKey].references.find(
          (r) => r.id === id && r.lineNumber === lineNumber
        );

        if (ref) {
          // Toggle not implemented state
          ref.notImplemented = !ref.notImplemented;

          // If marked as not implemented, it shouldn't be marked as done
          if (ref.notImplemented && ref.done) {
            ref.done = false;
          }
        } else {
          // Add new entry
          ref = { id, lineNumber, done: false, notImplemented: true };
          storageData[fileKey].references.push(ref);
        }

        // Save updated data
        fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

        // Fire change event to refresh tree
        this.refresh();

        return ref.notImplemented;
      } catch (error) {
        console.error(
          "Error toggling documentation reference not implemented state:",
          error
        );
        return false;
      }
    })();

    // Update decorations after toggling
    this.updateDecorations();

    return result;
  }

  /**
   * Set description for a documentation reference
   * @param {string} filePath File path
   * @param {string} id Documentation ID
   * @param {number} lineNumber Line number
   * @param {string} description User-provided description
   * @returns {boolean} Success status
   */
  setDocumentationReferenceDescription(filePath, id, lineNumber, description) {
    try {
      const storageFile = this._getDocumentationStorageFile();

      // Read existing data or create new
      let storageData = {};
      if (fs.existsSync(storageFile)) {
        storageData = JSON.parse(fs.readFileSync(storageFile, "utf8"));
      }

      const fileKey = this._normalizePathForStorage(filePath);

      // Initialize file entry if needed
      if (!storageData[fileKey]) {
        storageData[fileKey] = {
          references: [],
        };
      }

      // Find existing reference or add new one
      let ref = storageData[fileKey].references.find(
        (r) => r.id === id && r.lineNumber === lineNumber
      );

      if (ref) {
        // Update description
        ref.userDescription = description;
      } else {
        // Add new entry
        ref = { id, lineNumber, userDescription: description };
        storageData[fileKey].references.push(ref);
      }

      // Save updated data
      fs.writeFileSync(storageFile, JSON.stringify(storageData, null, 2));

      // Fire change event to refresh tree
      this.refresh();

      return true;
    } catch (error) {
      console.error(
        "Error setting documentation reference description:",
        error
      );
      return false;
    }
  }

  updateDecorations() {
    if (!this.currentEditor) {
      return;
    }

    // Only apply decorations for .txt files
    const filePath = this.currentEditor.document.uri.fsPath;
    const fileExt = path.extname(filePath).toLowerCase();
    if (fileExt !== ".txt") {
      return;
    }

    try {
      const doneDecorations = [];
      const undoneDecorations = [];
      const notImplementedDecorations = [];

      const docRefs = this._findDocumentationReferences(
        this.currentEditor.document.getText(),
        filePath
      );

      docRefs.forEach((ref) => {
        const line = ref.lineNumber - 1;
        const range = new vscode.Range(
          new vscode.Position(line, 0),
          new vscode.Position(line, Number.MAX_VALUE)
        );

        if (ref.notImplemented) {
          notImplementedDecorations.push(range);
        } else if (ref.done) {
          doneDecorations.push(range);
        } else {
          undoneDecorations.push(range);
        }
      });

      this.currentEditor.setDecorations(
        this.doneDecorationType,
        doneDecorations
      );
      this.currentEditor.setDecorations(
        this.undoneDecorationType,
        undoneDecorations
      );
      this.currentEditor.setDecorations(
        this.notImplementedDecorationType,
        notImplementedDecorations
      );
    } catch (error) {
      console.error("Error updating decorations:", error);
    }
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.disposable) {
      this.disposable.dispose();
    }
    if (this.configDisposable) {
      this.configDisposable.dispose();
    }

    // Save state before disposing
    this.saveExpandedState();

    this._onDidChangeTreeData.dispose();
    if (this.editorChangeDisposable) {
      this.editorChangeDisposable.forEach((d) => d.dispose());
    }
    this.doneDecorationType.dispose();
    this.undoneDecorationType.dispose();
    this.notImplementedDecorationType.dispose();
  }
}

/**
 * Base tree item class
 */
class TreeItem extends vscode.TreeItem {
  constructor(label, collapsibleState) {
    super(label, collapsibleState);
  }

  getChildren() {
    return [];
  }
}

/**
 * Tree item for no file selected
 */
class NoFileItem extends TreeItem {
  constructor() {
    super("No file selected", vscode.TreeItemCollapsibleState.None);
    this.description = "Open a .txt or .al file to see references";
    this.contextValue = "noFile";

    // Add example documentation IDs for testing
    this.tooltip =
      "Documentation ID examples: BC0001, CUSTOM001, #ICCH103/03:400111";
  }
}

/**
 * Tree item for unsupported file types
 */
class UnsupportedFileItem extends TreeItem {
  constructor() {
    super("Unsupported file type", vscode.TreeItemCollapsibleState.None);
    this.description = "Only .txt and .al files are supported";
    this.contextValue = "unsupportedFile";
  }
}

/**
 * Tree item for referenced objects
 */
class ReferencedObjectItem extends TreeItem {
  constructor(type, id, indexFolder) {
    const label = `${type} ${id}`;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "referencedObject";
    this.command = {
      command: "bc-al-upgradeassistant.openReferencedObject",
      title: "Open Object",
      arguments: [type, id, indexFolder],
    };
    this.iconPath = new vscode.ThemeIcon("file-code");

    // Try to get object name
    const objectFolder = path.join(indexFolder, type.toLowerCase(), id);
    const infoFilePath = path.join(objectFolder, "info.json");

    if (fs.existsSync(infoFilePath)) {
      const infoData = JSON.parse(fs.readFileSync(infoFilePath, "utf8"));
      if (infoData.fileName) {
        const fileNameMatch = infoData.fileName.match(/_(.+)\.al$/);
        if (fileNameMatch) {
          this.description = fileNameMatch[1].replace(/_/g, " ");
        }
      }
    }
  }
}

/**
 * Tree item for info key-value
 */
class InfoItem extends TreeItem {
  constructor(key, value) {
    super(key, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.contextValue = "infoItem";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

/**
 * Tree item for migration files
 */
// class MigrationFilesItem extends TreeItem {
//   constructor(files) {
//     super(
//       "Referenced Migration Files",
//       vscode.TreeItemCollapsibleState.Collapsed
//     );
//     this.files = files;
//     this.contextValue = "migrationFiles";
//     this.iconPath = new vscode.ThemeIcon("references");

//     // Set a unique ID for state persistence
//     this.id = `migrationFiles-${files.length}`;
//   }

//   getChildren() {
//     return this.files.map((file) => {
//       const item = new TreeItem(
//         path.basename(file),
//         vscode.TreeItemCollapsibleState.None
//       );
//       item.command = {
//         command: "bc-al-upgradeassistant.openMigrationFile",
//         title: "Open Migration File",
//         arguments: [file],
//       };
//       item.iconPath = new vscode.ThemeIcon("file");
//       return item;
//     });
//   }
// }

/**
 * Tree item for referenced objects group
 */
class ReferencedObjectsGroup extends TreeItem {
  constructor(objects) {
    super("Referenced Objects", vscode.TreeItemCollapsibleState.Collapsed);
    this.objects = objects;
    this.contextValue = "referencedObjectsGroup";
    this.iconPath = new vscode.ThemeIcon("references");

    // Set a unique ID so we can remember expanded state
    this.id = `refObjectsGroup-${this.objects.length}`;
  }

  getChildren() {
    return this.objects;
  }
}

/**
 * Tree item for documentation references
 */
class DocumentationRefsItem extends TreeItem {
  constructor(docRefs, filePath) {
    super(
      "Documentation References",
      vscode.TreeItemCollapsibleState.Collapsed
    );
    this.docRefs = docRefs;
    this.filePath = filePath;
    this.contextValue = "documentationRefs";
    this.iconPath = new vscode.ThemeIcon("book");

    // Count distinct documentation IDs
    this.distinctIds = [...new Set(docRefs.map((ref) => ref.id))];

    // Set a unique ID so we can remember expanded state
    this.id = `docRefs-${filePath}`;
  }

  getChildren() {
    // If only one type of documentation ID or just a few references, return flat list
    if (this.distinctIds.length <= 1 || this.docRefs.length <= 3) {
      return this.docRefs.map((ref) => {
        return new DocumentationRefItem(ref, this.filePath);
      });
    }

    // Otherwise, group by documentation ID
    return this.distinctIds.map((id) => {
      const refsForId = this.docRefs.filter((ref) => ref.id === id);
      return new DocumentationRefGroupItem(id, refsForId, this.filePath);
    });
  }
}

/**
 * Tree item for a group of documentation references with the same ID
 */
class DocumentationRefGroupItem extends TreeItem {
  constructor(id, docRefs, filePath) {
    // Find the first reference to get description info
    const firstRef = docRefs[0];
    const description = firstRef ? firstRef.description : "";

    super(id, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${description} (${docRefs.length} references)`;
    this.docRefs = docRefs;
    this.filePath = filePath;
    this.contextValue = "documentationRefGroup";
    this.iconPath = new vscode.ThemeIcon("symbol-folder");

    // Set a unique ID so we can remember expanded state
    this.id = `docRefGroup-${filePath}-${id}`;

    // When a docRef in this group has a URL, expose it for context menu
    const refWithUrl = docRefs.find((ref) => ref.url);
    if (refWithUrl && refWithUrl.url) {
      this.docUrl = refWithUrl.url;
    }
  }

  getChildren() {
    return this.docRefs.map((ref) => {
      return new DocumentationRefItem(ref, this.filePath);
    });
  }
}

/**
 * Tree item for a single documentation reference
 */
class DocumentationRefItem extends TreeItem {
  constructor(docRef, filePath) {
    // Use the context (line content) as the label, limited to 500 chars
    let contextText = docRef.context || "";

    // Remove the documentation ID from the displayed content
    const idRegex = new RegExp(docRef.id, "g");
    contextText = contextText.replace(idRegex, "").trim();

    // Handle any double spaces that might be left after removing the ID
    contextText = contextText.replace(/\s+/g, " ").trim();

    const label =
      contextText.length > 500
        ? contextText.substring(0, 499) + "..."
        : contextText;

    super(label, vscode.TreeItemCollapsibleState.None);
    this.docRef = docRef;
    this.filePath = filePath;

    // Show ID and line number in the description
    let description = `${docRef.id} (line ${docRef.lineNumber})`;

    // Add user description if available
    if (docRef.userDescription) {
      description = `${description} - ${docRef.userDescription}`;
    }

    this.description = description;

    // Set context value based on status
    if (docRef.notImplemented) {
      this.contextValue = "documentationRefNotImplemented";
    } else if (docRef.done) {
      this.contextValue = "documentationRefDone";
    } else {
      this.contextValue = "documentationRef";
    }

    // Set icon based on status
    if (docRef.notImplemented) {
      this.iconPath = new vscode.ThemeIcon("circle-slash");
    } else if (docRef.done) {
      this.iconPath = new vscode.ThemeIcon("check");
    } else {
      this.iconPath = new vscode.ThemeIcon("book");
    }

    // Command to jump to the line
    this.command = {
      command: "bc-al-upgradeassistant.openDocumentationReference",
      title: "Open Reference Location",
      arguments: [filePath, docRef.lineNumber],
    };

    // Include the context in the tooltip for more information
    let tooltipText = `${docRef.id}: ${docRef.description}\n\nLine: ${docRef.lineNumber}`;

    // Add user description to tooltip if available
    if (docRef.userDescription) {
      tooltipText += `\n\nUser Note: ${docRef.userDescription}`;
    }

    tooltipText += `\n\nClick to open file at reference location\nRight-click for more options`;

    this.tooltip = tooltipText;

    // Create separate properties instead of arrays for arguments
    // This ensures VS Code can correctly pick up the arguments
    this.filePath = filePath;
    this.docId = docRef.id;
    this.lineNumber = docRef.lineNumber;
    this.docUrl = docRef.url || "";
  }
}

// Add new class for enhanced migration files item
class EnhancedMigrationFilesItem extends TreeItem {
  constructor(files, migrationFileRefs) {
    super(
      "Referenced Migration Files",
      vscode.TreeItemCollapsibleState.Collapsed
    );
    this.files = files;
    this.migrationFileRefs = migrationFileRefs;
    this.contextValue = "migrationFiles";
    this.iconPath = new vscode.ThemeIcon("references");

    // Use unique ID for state persistence that includes file info
    const fileHashes = files.map((f) => path.basename(f)).join("-");
    this.id = `enhancedMigFiles-${fileHashes}`;
  }

  getChildren() {
    const items = [];

    this.files.forEach((file) => {
      const fileRefs = this.migrationFileRefs.find((r) => r.file === file);
      const fileItem = new MigrationFileItem(file, fileRefs?.refs || []);
      items.push(fileItem);
    });

    return items;
  }
}

// Add new class for individual migration file items
class MigrationFileItem extends TreeItem {
  constructor(file, docRefs) {
    super(
      path.basename(file),
      docRefs.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.filePath = file;
    this.docRefs = docRefs;
    this.contextValue = "migrationFile";
    this.iconPath = new vscode.ThemeIcon("file");

    // Command to open file
    this.command = {
      command: "bc-al-upgradeassistant.openMigrationFile",
      title: "Open Migration File",
      arguments: [file],
    };

    // Unique ID for state persistence that includes file path and refs count
    if (docRefs.length > 0) {
      this.id = `migFile-${path.basename(file)}-${docRefs.length}`;
    }
  }

  getChildren() {
    if (this.docRefs && this.docRefs.length > 0) {
      return this.docRefs.map(
        (ref) => new DocumentationRefItem(ref, this.filePath)
      );
    }
    return [];
  }
}

module.exports = FileReferenceProvider;
