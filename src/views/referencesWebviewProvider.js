const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

// Import TreeItem class for reference
class TreeItem extends vscode.TreeItem {
  constructor(label, collapsibleState) {
    super(label, collapsibleState);
  }
}

/**
 * Webview provider for BC/AL references that can be popped out
 */
class ReferencesWebviewProvider {
  constructor(fileReferenceProvider, context) {
    this.fileReferenceProvider = fileReferenceProvider;
    this.context = context;
    this.webviewPanel = null;
    this.currentData = null;

    // Listen for changes in the file reference provider
    this.fileReferenceProvider.onDidChangeTreeData(() => {
      this.updateWebview();
    });

    // Listen for active editor changes
    this.disposable = vscode.window.onDidChangeActiveTextEditor(() => {
      this.updateWebview();
    });
  }

  /**
   * Create and show the webview panel
   */
  async createWebview() {
    // If webview already exists, just reveal it
    if (this.webviewPanel) {
      this.webviewPanel.reveal();
      return;
    }

    // Create webview panel
    this.webviewPanel = vscode.window.createWebviewPanel(
      'bcAlReferences',
      'BC/AL References',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'views', 'webview-content'))
        ]
      }
    );

    // Set the webview's icon
    this.webviewPanel.iconPath = {
      light: vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'relationship-icon.svg')),
      dark: vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'relationship-icon.svg'))
    };

    // Handle webview disposal
    this.webviewPanel.onDidDispose(() => {
      this.webviewPanel = null;
    });

    // Handle messages from webview
    this.webviewPanel.webview.onDidReceiveMessage(
      message => this.handleWebviewMessage(message),
      undefined,
      this.context.subscriptions
    );

    // Set initial content
    await this.updateWebview();
  }

  /**
   * Update the webview content with current data
   */
  async updateWebview() {
    if (!this.webviewPanel) return;

    try {
      // Get current data from file reference provider
      const data = await this.getCurrentData();
      this.currentData = data;

      // Generate HTML content
      const html = this.generateHtmlContent(data);
      this.webviewPanel.webview.html = html;
    } catch (error) {
      console.error('Error updating webview:', error);
    }
  }

  /**
   * Get current data from the file reference provider
   */
  async getCurrentData() {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return { items: [], filePath: null, filterMode: this.fileReferenceProvider.filterMode };
    }

    const filePath = activeEditor.document.uri.fsPath;
    const items = await this.fileReferenceProvider.getChildren();

    return {
      items: await this.processTreeItems(items),
      filePath,
      filterMode: this.fileReferenceProvider.filterMode
    };
  }

  /**
   * Process tree items recursively to extract data
   */
  async processTreeItems(items) {
    const processedItems = [];

    for (const item of items) {
      const processedItem = {
        id: item.id,
        label: item.label,
        description: item.description,
        tooltip: item.tooltip,
        contextValue: item.contextValue,
        collapsibleState: item.collapsibleState,
        iconPath: item.iconPath,
        command: item.command,
        resourceUri: item.resourceUri
      };

      // Add custom properties for different item types
      if (item.filePath) processedItem.filePath = item.filePath;
      if (item.lineNumber !== undefined) processedItem.lineNumber = item.lineNumber;
      if (item.docId) processedItem.docId = item.docId;
      if (item.done !== undefined) processedItem.done = item.done;
      if (item.notImplemented !== undefined) processedItem.notImplemented = item.notImplemented;
      if (item.userDescription) processedItem.userDescription = item.userDescription;
      if (item.taskId) processedItem.taskId = item.taskId;
      if (item.type) processedItem.type = item.type;
      if (item.number) processedItem.number = item.number;
      if (item.indexFolder) processedItem.indexFolder = item.indexFolder;
      if (item.docUrl) processedItem.docUrl = item.docUrl;
      if (item.startLine !== undefined) processedItem.startLine = item.startLine;
      if (item.endLine !== undefined) processedItem.endLine = item.endLine;

      // Get children if collapsible
      if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
        try {
          const children = await this.fileReferenceProvider.getChildren(item);
          processedItem.children = await this.processTreeItems(children);
        } catch (error) {
          console.error('Error getting children for item:', item.label, error);
          processedItem.children = [];
        }
      }

      processedItems.push(processedItem);
    }

    return processedItems;
  }

  /**
   * Generate HTML content for the webview
   */
  generateHtmlContent(data) {
    const cssUri = this.webviewPanel.webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'views', 'webview-content', 'references.css'))
    );

    const jsUri = this.webviewPanel.webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'views', 'webview-content', 'references.js'))
    );

    const codiconsUri = this.webviewPanel.webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'))
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BC/AL References</title>
    <link href="${codiconsUri}" rel="stylesheet" />
    <link href="${cssUri}" rel="stylesheet" />
</head>
<body>
    <div class="header">
        <h2>BC/AL References</h2>
        <div class="toolbar">
            <button id="refresh-btn" class="toolbar-btn" title="Refresh">
                <i class="codicon codicon-refresh"></i>
            </button>
            <button id="filter-done-btn" class="toolbar-btn ${data.filterMode === 'done' ? 'active' : ''}" title="Show Done Tasks">
                <i class="codicon codicon-check"></i>
            </button>
            <button id="filter-not-done-btn" class="toolbar-btn ${data.filterMode === 'notDone' ? 'active' : ''}" title="Show Not Done Tasks">
                <i class="codicon codicon-circle-outline"></i>
            </button>
            <button id="clear-filters-btn" class="toolbar-btn ${data.filterMode === 'all' ? 'active' : ''}" title="Show All Tasks">
                <i class="codicon codicon-clear-all"></i>
            </button>
        </div>
    </div>
    <div class="content">
        ${this.generateTreeHtml(data.items)}
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const data = ${JSON.stringify(data)};
    </script>
    <script src="${jsUri}"></script>
</body>
</html>`;
  }

  /**
   * Generate HTML for tree items
   */
  generateTreeHtml(items, level = 0) {
    if (!items || items.length === 0) {
      return '<div class="no-items">No items to display</div>';
    }

    let html = '<ul class="tree-list">';

    for (const item of items) {
      const hasChildren = item.children && item.children.length > 0;
      const isExpanded = item.collapsibleState === vscode.TreeItemCollapsibleState.Expanded;
      const indent = level * 16;

      html += `<li class="tree-item" data-level="${level}" style="padding-left: ${indent}px;">`;

      // Expand/collapse icon
      if (hasChildren) {
        html += `<span class="expand-icon ${isExpanded ? 'expanded' : ''}" data-item-id="${item.id}">
                   <i class="codicon codicon-chevron-right"></i>
                 </span>`;
      } else {
        html += '<span class="expand-icon-placeholder"></span>';
      }

      // Item icon
      if (item.iconPath) {
        const iconClass = this.getIconClass(item);
        html += `<span class="item-icon"><i class="codicon ${iconClass}"></i></span>`;
      }

      // Item content
      html += `<div class="item-content" data-context-value="${item.contextValue || ''}" data-item-id="${item.id}">`;

      // Label and description
      html += `<span class="item-label">${this.escapeHtml(item.label)}</span>`;
      if (item.description) {
        html += `<span class="item-description">${this.escapeHtml(item.description)}</span>`;
      }

      // Action buttons
      html += this.generateActionButtons(item);

      html += '</div>';

      // Children
      if (hasChildren && isExpanded) {
        html += this.generateTreeHtml(item.children, level + 1);
      }

      html += '</li>';
    }

    html += '</ul>';
    return html;
  }

  /**
   * Generate action buttons for an item
   */
  generateActionButtons(item) {
    let buttons = '<div class="action-buttons">';

    // Toggle done button
    if (item.contextValue && (
      item.contextValue.includes('documentationRef') ||
      item.contextValue.includes('procedureItem') ||
      item.contextValue.includes('triggerItem') ||
      item.contextValue.includes('actionItem') ||
      item.contextValue.includes('fieldItem')
    )) {
      const doneClass = item.done ? 'active' : '';
      buttons += `<button class="action-btn toggle-done-btn ${doneClass}"
                    data-action="toggleDone"
                    data-item-id="${item.id}"
                    title="Toggle Done">
                    <i class="codicon codicon-check"></i>
                  </button>`;
    }

    // Add note button
    if (item.contextValue && (
      item.contextValue.includes('documentationRef') ||
      item.contextValue.includes('procedureItem') ||
      item.contextValue.includes('triggerItem') ||
      item.contextValue.includes('actionItem') ||
      item.contextValue.includes('fieldItem')
    )) {
      buttons += `<button class="action-btn add-note-btn"
                    data-action="addNote"
                    data-item-id="${item.id}"
                    title="Add/Edit Note">
                    <i class="codicon codicon-edit"></i>
                  </button>`;
    }

    // Toggle not implemented button
    if (item.contextValue && item.contextValue.includes('documentationRef')) {
      const notImplClass = item.notImplemented ? 'active' : '';
      buttons += `<button class="action-btn toggle-not-impl-btn ${notImplClass}"
                    data-action="toggleNotImplemented"
                    data-item-id="${item.id}"
                    title="Toggle Not Implemented">
                    <i class="codicon codicon-circle-slash"></i>
                  </button>`;
    }

    // Open documentation URL button
    if (item.docUrl) {
      buttons += `<button class="action-btn open-url-btn"
                    data-action="openUrl"
                    data-url="${item.docUrl}"
                    title="Open Documentation URL">
                    <i class="codicon codicon-link-external"></i>
                  </button>`;
    }

    buttons += '</div>';
    return buttons;
  }

  /**
   * Get icon class for an item
   */
  getIconClass(item) {
    if (item.done) return 'codicon-check';
    if (item.notImplemented) return 'codicon-circle-slash';
    if (item.contextValue?.includes('documentationRef')) return 'codicon-book';
    if (item.contextValue?.includes('procedureItem')) return 'codicon-symbol-method';
    if (item.contextValue?.includes('triggerItem')) return 'codicon-symbol-event';
    if (item.contextValue?.includes('actionItem')) return 'codicon-symbol-function';
    if (item.contextValue?.includes('fieldItem')) return 'codicon-symbol-field';
    if (item.contextValue?.includes('referencedObject')) return 'codicon-file-code';
    if (item.contextValue?.includes('migrationFile')) return 'codicon-file';
    return 'codicon-circle-outline';
  }

  /**
   * Escape HTML characters
   */
  escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Handle messages from the webview
   */
  async handleWebviewMessage(message) {
    try {
      switch (message.command) {
        case 'refresh':
          await this.updateWebview();
          break;

        case 'filterDone':
          this.fileReferenceProvider.setFilterMode('done');
          await this.updateWebview();
          break;

        case 'filterNotDone':
          this.fileReferenceProvider.setFilterMode('notDone');
          await this.updateWebview();
          break;

        case 'clearFilters':
          this.fileReferenceProvider.setFilterMode('all');
          await this.updateWebview();
          break;

        case 'toggleExpand':
          this.fileReferenceProvider.setItemExpandedState(message.itemId, message.expanded);
          await this.updateWebview();
          break;

        case 'toggleDone':
          await this.handleToggleDone(message.itemId);
          break;

        case 'addNote':
          await this.handleAddNote(message.itemId);
          break;

        case 'toggleNotImplemented':
          await this.handleToggleNotImplemented(message.itemId);
          break;

        case 'openUrl':
          vscode.env.openExternal(vscode.Uri.parse(message.url));
          break;

        case 'openReference':
          await this.handleOpenReference(message.itemId);
          break;

        default:
          console.warn('Unknown webview message command:', message.command);
      }
    } catch (error) {
      console.error('Error handling webview message:', error);
      vscode.window.showErrorMessage(`Error: ${error.message}`);
    }
  }

  /**
   * Handle toggle done action
   */
  async handleToggleDone(itemId) {
    const item = this.findItemById(itemId);
    if (!item) return;

    if (item.contextValue?.includes('documentationRef')) {
      this.fileReferenceProvider.toggleDocumentationReferenceDone(
        item.filePath, item.docId, item.lineNumber
      );
    } else if (item.contextValue?.includes('procedureItem')) {
      this.fileReferenceProvider.toggleProcedureReferencesDone(
        item.filePath, item.startLine, item.endLine
      );
    } else if (item.contextValue?.includes('triggerItem')) {
      this.fileReferenceProvider.toggleTriggerReferencesDone(
        item.filePath, item.startLine, item.endLine
      );
    } else if (item.contextValue?.includes('actionItem')) {
      this.fileReferenceProvider.toggleActionReferencesDone(
        item.filePath, item.startLine, item.endLine
      );
    } else if (item.contextValue?.includes('fieldItem')) {
      this.fileReferenceProvider.toggleFieldReferencesDone(
        item.filePath, item.startLine, item.endLine
      );
    }
  }

  /**
   * Handle add note action
   */
  async handleAddNote(itemId) {
    const item = this.findItemById(itemId);
    if (!item) return;

    const description = await vscode.window.showInputBox({
      prompt: 'Enter a description/note',
      value: item.userDescription || '',
      placeHolder: 'Description'
    });

    if (description === undefined) return; // User cancelled

    if (item.contextValue?.includes('documentationRef')) {
      this.fileReferenceProvider.setDocumentationReferenceDescription(
        item.filePath, item.docId, item.lineNumber, description
      );
    } else if (item.contextValue?.includes('procedureItem')) {
      this.fileReferenceProvider.setProcedureReferencesDescription(
        item.filePath, item.startLine, item.endLine, description
      );
    } else if (item.contextValue?.includes('triggerItem')) {
      this.fileReferenceProvider.setTriggerReferencesDescription(
        item.filePath, item.startLine, item.endLine, description
      );
    } else if (item.contextValue?.includes('actionItem')) {
      this.fileReferenceProvider.setActionReferencesDescription(
        item.filePath, item.startLine, item.endLine, description
      );
    } else if (item.contextValue?.includes('fieldItem')) {
      this.fileReferenceProvider.setFieldReferencesDescription(
        item.filePath, item.startLine, item.endLine, description
      );
    }
  }

  /**
   * Handle toggle not implemented action
   */
  async handleToggleNotImplemented(itemId) {
    const item = this.findItemById(itemId);
    if (!item || !item.contextValue?.includes('documentationRef')) return;

    // If toggling to not implemented, ask for description
    let description = '';
    if (!item.notImplemented) {
      description = await vscode.window.showInputBox({
        prompt: 'Enter a description for why this is not implemented',
        placeHolder: 'Optional description'
      });
      if (description === undefined) return; // User cancelled
    }

    this.fileReferenceProvider.toggleDocumentationReferenceNotImplemented(
      item.filePath, item.docId, item.lineNumber, description
    );
  }

  /**
   * Handle open reference action
   */
  async handleOpenReference(itemId) {
    const item = this.findItemById(itemId);
    if (!item) return;

    if (item.filePath && item.lineNumber) {
      vscode.commands.executeCommand(
        'bc-al-upgradeassistant.openDocumentationReference',
        item.filePath,
        item.lineNumber
      );
    } else if (item.type && item.number && item.indexFolder) {
      vscode.commands.executeCommand(
        'bc-al-upgradeassistant.openReferencedObject',
        item.type,
        item.number,
        item.indexFolder
      );
    }
  }

  /**
   * Find an item by ID in the current data
   */
  findItemById(itemId, items = null) {
    if (!items) items = this.currentData?.items || [];

    for (const item of items) {
      if (item.id === itemId) return item;
      if (item.children) {
        const found = this.findItemById(itemId, item.children);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Dispose of resources
   */
  dispose() {
    if (this.webviewPanel) {
      this.webviewPanel.dispose();
    }
    if (this.disposable) {
      this.disposable.dispose();
    }
  }
}

module.exports = ReferencesWebviewProvider;
