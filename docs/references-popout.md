# BC/AL References Popout Feature

## Overview

The BC/AL Upgrade Assistant now supports popping out the references view into a separate window. This allows users to have the references view in a dedicated window while working with their code in the main VS Code window.

## Features

The popout references view includes all the same functionality as the original sidebar view:

- **Toggle Done/Not Done**: Mark references as completed or pending
- **Add Notes**: Add custom descriptions to references
- **Filter by Status**: Show only done, not done, or all references
- **Toggle Not Implemented**: Mark documentation references as not implemented
- **Open References**: Double-click to open referenced files
- **Keyboard Navigation**: Use arrow keys to navigate the tree
- **Expand/Collapse**: Click chevrons to expand or collapse tree items

## How to Use

### Opening the Popout View

1. **From the Command Palette**:
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Type "Pop Out References View"
   - Select the command

2. **From the References View**:
   - Open the BC/AL References view in the sidebar
   - Click the "Pop Out" button (external link icon) in the view toolbar

### Using the Popout View

The popout view behaves exactly like the original references view:

- **Toolbar Buttons**:
  - 🔄 Refresh: Reload the references data
  - ✓ Show Done: Filter to show only completed references
  - ○ Show Not Done: Filter to show only pending references
  - ⊗ Show All: Clear filters and show all references

- **Tree Interactions**:
  - **Single Click**: Select an item
  - **Double Click**: Open the referenced file/location
  - **Right Click**: Context menu with common actions
  - **Hover**: Show action buttons (toggle done, add note, etc.)

- **Keyboard Shortcuts**:
  - `↑/↓`: Navigate up/down
  - `←/→`: Collapse/expand items
  - `Enter`: Open selected reference
  - `Space`: Toggle done status

### Managing Multiple Windows

- You can have multiple popout windows open simultaneously
- Each window maintains its own state and filters
- Changes made in one window are reflected in all other windows
- The popout window can be moved to a separate monitor

## Technical Implementation

### Architecture

The popout functionality is implemented using:

- **ReferencesWebviewProvider**: Main class that creates and manages the webview
- **HTML/CSS/JS**: Custom web interface that mirrors the tree view functionality
- **Message Passing**: Communication between the webview and VS Code extension
- **Shared Data Source**: Uses the same FileReferenceProvider as the sidebar view

### Files Added/Modified

- `src/views/referencesWebviewProvider.js` - Main webview provider class
- `src/views/webview-content/references.html` - HTML template (generated dynamically)
- `src/views/webview-content/references.css` - Styling for the webview
- `src/views/webview-content/references.js` - Client-side JavaScript for interactivity
- `src/registerCommands.js` - Added popout command registration
- `package.json` - Added command definition and menu items

### Dependencies

- `@vscode/codicons` - For consistent VS Code icons in the webview

## Troubleshooting

### Common Issues

1. **Webview doesn't load**:
   - Check that the extension is properly activated
   - Ensure all webview content files are present
   - Check the VS Code developer console for errors

2. **Actions don't work**:
   - Verify that the FileReferenceProvider is properly initialized
   - Check that message passing is working between webview and extension

3. **Styling issues**:
   - Ensure the codicons CSS is loading properly
   - Check that VS Code theme variables are available

### Debug Mode

To enable debug logging for the popout functionality:

1. Open VS Code settings
2. Search for "BC/AL Upgrade Assistant"
3. Enable debug logging
4. Check the Output panel for detailed logs

## Future Enhancements

Potential improvements for future versions:

- **Persistent Window State**: Remember window position and size
- **Drag and Drop**: Support for dragging references between windows
- **Custom Themes**: Additional styling options for the webview
- **Export Functionality**: Export references to external formats
- **Search and Filter**: Advanced search capabilities within the popout view

## Contributing

If you encounter issues or have suggestions for improvements:

1. Check the existing issues on the project repository
2. Create a new issue with detailed reproduction steps
3. Include VS Code version, extension version, and any error messages
4. Consider submitting a pull request with fixes or enhancements
