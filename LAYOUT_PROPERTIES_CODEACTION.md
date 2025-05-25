# Layout Properties CodeAction Implementation

This document describes the implementation of a VS Code CodeAction that transforms old AL layout properties to the new rendering syntax.

## Overview

The CodeAction automatically detects old layout properties in AL report objects and provides quick fixes to transform them to the modern rendering block syntax.

### Transformation Example

**Before (Old Syntax):**
```al
report 50100 "Test Report"
{
  RDLCLayout = '.\_Base\report\terwet.rdl';
  WordLayout =  '.\_Base\report\terwet.docx'; 
}
```

**After (New Syntax):**
```al
report 50100 "Test Report" 
{ 
  rendering 
  { 
    layout(RDLCLayout) 
    { 
      Type = RDLC; 
      LayoutFile = '.\_Base\report\terwet.rdl'; 
    } 
    layout(WordLayout) 
    { 
      Type = Word; 
      LayoutFile = '.\_Base\report\terwet.docx'; 
    } 
  } 
}
```

## Implementation Details

### Files Created/Modified

1. **`src/providers/layoutPropertiesActionProvider.js`** - New CodeAction provider
2. **`src/extension.js`** - Updated to register the new provider

### Key Features

- **Pattern Detection**: Automatically detects `RDLCLayout` and `WordLayout` properties
- **Report Boundary Detection**: Correctly identifies report object boundaries using brace counting
- **Indentation Preservation**: Maintains proper indentation in the generated code
- **Multiple Properties**: Handles reports with multiple layout properties
- **Bulk Transformation**: Provides options to transform all properties at once or individually

### Technical Implementation

#### Pattern Matching
The implementation uses regular expressions to detect:
- Report declarations: `/^\s*report\s+(\d+)\s+"([^"]+)"\s*$/`
- RDLCLayout properties: `/^(\s*)(RDLCLayout)\s*=\s*['"]([^'"]+)['"];?\s*$/`
- WordLayout properties: `/^(\s*)(WordLayout)\s*=\s*['"]([^'"]+)['"];?\s*$/`

#### Algorithm
1. **First Pass**: Find all report objects and their boundaries
2. **Second Pass**: Search for layout properties within each report
3. **Transformation**: Generate new rendering block syntax
4. **Code Actions**: Provide VS Code quick fix options

#### Code Structure
```javascript
class LayoutPropertiesActionProvider {
  async provideCodeActions(document, range, context) {
    // 1. Extract layout properties from document
    // 2. Generate transformation actions
    // 3. Return CodeAction array
  }
}
```

### Usage

1. Open an AL file containing old layout properties
2. Place cursor anywhere in the file
3. Press `Ctrl+.` (Windows/Linux) or `Cmd+.` (Mac) to open Quick Fix menu
4. Select one of the transformation options:
   - "Transform to new rendering syntax (N layouts)" - Transform all properties
   - "Transform [PropertyName] to new syntax" - Transform individual property

### CodeAction Types

The implementation provides `vscode.CodeActionKind.RefactorRewrite` actions, which appear in the "Refactor" section of the Quick Fix menu.

### Error Handling

- Gracefully handles malformed AL code
- Skips reports without layout properties
- Preserves original formatting when possible
- Logs debug information for troubleshooting

### Testing

The implementation has been tested with:
- Single layout property reports
- Multiple layout property reports
- Reports with complex nested structures
- Various indentation styles
- Different quote styles (single/double quotes)

## Future Enhancements

Potential improvements could include:
- Support for additional layout types
- Range-specific transformations
- Undo/redo integration
- Batch processing across multiple files
- Configuration options for formatting preferences

## Integration

The CodeAction is automatically registered when the BC/AL Upgrade Assistant extension is activated and will appear for any AL language files containing the old layout property syntax.
