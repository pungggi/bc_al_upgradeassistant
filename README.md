# BC/AL Upgrade Assistant

A Visual Studio Code extension to assist in transforming old C/AL code to modern AL syntax and provide AI-powered assistance for Microsoft Dynamics 365 Business Central development.

## Features

- Split C/AL objects from text files
- Convert C/AL code to AL syntax
- AI-powered code review and suggestions using Claude models
- Code formatting and documentation help

### Documentation Reference Management

The extension helps track and manage documentation references in your code:

- Track documentation references with status (Done/Not Done/Not Implemented)
- Add notes to documentation references
- Toggle implementation status
- Generate summary reports of all documentation references with statistics

![Prompt Dialog](https://imgur.com/Fdwiq2K.png)

## Requirements

- Visual Studio Code 1.80.0 or higher
- Claude API key for AI-powered features

## Extension Settings

### Claude AI Settings

This extension contributes the following settings:

- `bc-al-upgradeassistant.claude.apiKey`: API Key for accessing Claude API
- `bc-al-upgradeassistant.claude.model`: Claude model to use for API requests
- `bc-al-upgradeassistant.claude.maxTokens`: Maximum number of tokens Claude can generate (default: 4096)
- `bc-al-upgradeassistant.claude.temperature`: Creativity control (0-1), lower values produce more deterministic outputs (default: 0.5)
- `bc-al-upgradeassistant.claude.defaultSystemPrompt`: Default system prompt to use with Claude API
- `bc-al-upgradeassistant.claude.defaultLanguage`: Default language code (e.g., "de-DE") to use in prompts as the translation language
- `bc-al-upgradeassistant.claude.prompts`: Collection of prompts for Claude API
- `bc-al-upgradeassistant.claude.autoSaveAlCode`: When enabled, automatically saves AL code blocks from Claude responses
- `bc-al-upgradeassistant.claude.codeSaveMode`: How to handle multiple AL code blocks ("ask" or "saveAll")
- `bc-al-upgradeassistant.claude.debugMode`: When enabled, shows the prompt being sent to Claude API in a document for review before sending

### Object Folders Settings

- `bc-al-upgradeassistant.upgradedObjectFolders`: Locations where to save upgraded AL objects by type
  - Includes a `basePath` property which specifies the base folder for all object types
- `bc-al-upgradeassistant.workingObjectFolders`: Locations where working AL objects are located

### Additional Settings

- `bc-al-upgradeassistant.userId`: User identifier used to attach to documentation references when toggling their status.

## Commands

### General

- `BC/AL Upgrade Assistant: Refresh Symbol Cache`: Refreshes the symbol cache to update object metadata.
- `BC/AL Upgrade Assistant: Split C/AL Objects`: Splits C/AL objects from a text file into individual files.

### Documentation

- `BC/AL Upgrade Assistant: Open Documentation Reference Location`: Opens the location of the documentation reference.
- `BC/AL Upgrade Assistant: Toggle Documentation Reference as Done/Not Done`: Toggles the completion status of a documentation reference and silently adds the configured UserId if set.
- `BC/AL Upgrade Assistant: Open Documentation URL`: Opens the URL associated with a documentation reference.
- `BC/AL Upgrade Assistant: Toggle Not Implemented`: Toggles the 'Not Implemented' status of a documentation reference.
- `BC/AL Upgrade Assistant: Add/Edit Note`: Adds or edits a note for a documentation reference.
- `BC/AL Upgrade Assistant: Generate Documentation References Summary`: Generates a summary report of all documentation references.

### Navigation

- `BC/AL Upgrade Assistant: Open Referenced Object`: Opens the AL object referenced under the cursor.
- `BC/AL Upgrade Assistant: Open Migration File`: Opens the related migration file, if available.
- `BC/AL Upgrade Assistant: Refresh BC/AL References`: Refreshes the references view.

### AI Prompting

- `BC/AL Upgrade Assistant: Run Claude Prompt`: Runs a selected Claude AI prompt on the current code.
- `BC/AL Upgrade Assistant: Set Default Claude Model`: Sets the default Claude model to be used for AI prompts.

## Getting Started

1. Install the extension
2. Set your Claude API key in the extension settings
3. Open a C/AL or AL file
4. Use the commands from the command palette (Ctrl+Shift+P)

## Documentation IDs

The extension supports a collection of documentation references through the `bc-al-upgradeassistant.documentationIds` setting. This allows you to maintain a curated list of documentation references like tasks or projects.

### Default Documentation IDs

For demo, the extension includes these documentation references:

- **BC0001**: Business Central Development Documentation
- **AL0001**: AL Language Reference

### Customizing Documentation IDs

You can modify these defaults or add your own documentation references in your settings:

1. Open VS Code Settings (File > Preferences > Settings)
2. Search for "BC/AL documentation"
3. Click on "Edit in settings.json"
4. Modify the `bc-al-upgradeassistant.documentationIds` array

Example custom configuration:

```json
"bc-al-upgradeassistant.documentationIds": [
  {
    "id": "VAT001",
    "description": "Project Task for implementing the new VAT Logic",
    "url": "https://dev.azure.com/contoso/_userstory/vat"
  }
]
```

Each documentation ID requires:

- `id`: A unique identifier
- `description`: A brief description of the documentation
- `url`: (Optional) Link to the documentation resource

### Documentation References

#### Summary Report

The documentation reference summary report shows some Status indicators:

- ✅ Done
- ⏳ Pending
- ❌ Not Implemented
- Statistical overview with completion percentages
- References grouped by file and by documentation ID

The summary is displayed in two separate editor views.

### Debugging Claude Prompts

When working with complex prompts, you can enable the debug mode to review exactly what is being sent to the Claude API:

1. Set `bc-al-upgradeassistant.claude.debugMode` to `true` in your VS Code settings
2. Run any Claude command
3. A new document will open showing the system prompt, user prompt with your code inserted, and configuration details
4. You'll be prompted to confirm before the API call is made

### Configuring Custom Prompts

You can customize the AI prompts through the settings:

```json
"bc-al-upgradeassistant.claude.prompts": [
  {
    "commandName": "convertCALToAL",
    "commandDescription": "Convert C/AL code to modern AL syntax",
    "userPrompt": "Please convert the following C/AL code to AL:\n\n{{code}}",
    "systemPrompt": "You are an expert AL and C/AL programming assistant. You help developers convert legacy C/AL code to modern AL code for Business Central.",
  },
  {
    "commandName": "reviewALCode",
    "commandDescription": "Review AL code for best practices",
    "disabled": true,
    "systemPrompt": "You are an AL code reviewer specializing in Business Central best practices.",
    "userPrompt": "Review the following AL code and suggest improvements for performance and readability:\n\n{{code}}",
  },
  {
    "commandName": "explainComplexLogic",
    "commandDescription": "Explain complex logic using Opus model",
    "userPrompt": "Explain in detail how the following complex algorithm works:\n\n{{code}}",
    "systemPrompt": "You are an expert AL code explainer for Microsoft Dynamics 365 Business Central.",
    "model": "claude-3-opus-20240229",
  },
  {
    "commandName": "explainComplexAI",
    "commandDescription": "Use Claude 3.7 to explain complex AI concepts",
    "userPrompt": "Explain the following algorithm as if explaining to another developer:\n\n{{code}}",
    "systemPrompt": "You are an AI expert with deep understanding of complex algorithms. Explain concepts clearly.",
    "model": "claude-3-7-sonnet-20250219",
  }
]
```

Each prompt has the following properties:

- `commandName`: A unique identifier for the prompt (no spaces)
- `commandDescription`: A brief description of what the command does (shown in the selection dialog)
- `userPrompt`: The actual prompt template. Use `{{code}}` where you want the selected code to be inserted
- `systemPrompt`: (Optional) Instructions for the AI about its role
- `model`: (Optional) Specific Claude model to use for this prompt
- `disabled`: (Optional) A boolean to disable the prompt without removing it from the settings

**Notes:**

> The extension will validate model names and fall back to your default model if an invalid model is specified.

> After modifying prompts in settings, you'll need to reload the window for changes to take effect.

## Events

The extension exposes several events that you can subscribe to in your own extensions:

### File Events

The extension emits events when AL files are processed:

```javascript
const { fileEvents } = require("bc-al-upgradeassistant");

// Subscribe to file events
fileEvents((fileInfo) => {
  // fileInfo contains:
  // - path: string - Path to the AL file
  // - orginFilePath: string - Original C/AL file path if applicable
  console.log("AL file processed:", fileInfo.path);
});
```

These events are fired whenever:

- A C/AL file is converted to AL
- An AL file is saved or modified

This allows you to build additional functionality on top of the file processing pipeline.
