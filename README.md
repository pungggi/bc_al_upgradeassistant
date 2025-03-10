# BC/AL Upgrade Assistant

A Visual Studio Code extension to assist in transforming old C/AL code to modern AL syntax and provide AI-powered assistance for Microsoft Dynamics 365 Business Central development.

## Features

- Split C/AL objects from text files
- Convert C/AL code to AL syntax
- AI-powered code review and suggestions using Claude models
- Code formatting and documentation help

![Prompt Dialog](https://imgur.com/Fdwiq2K.png)

## Requirements

- Visual Studio Code 1.80.0 or higher
- Claude API key for AI-powered features

## Extension Settings

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
- `bc-al-upgradeassistant.upgradedObjectFolders`: Locations where to save upgraded AL objects by type
- `bc-al-upgradeassistant.workingObjectFolders`: Locations where working AL objects are located

## Commands

- `BC AL Upgrade Assistant: Refresh Symbol Cache`: Refreshes the symbol cache
- `BC AL Upgrade Assistant: Split C/AL Objects from File`: Splits C/AL objects from a text file
- `BC AL Upgrade Assistant: Run Claude AI Prompt`: Select and run a Claude AI prompt
- `BC AL Upgrade Assistant: Set Default Claude Model`: Change the default Claude model with a dropdown menu

## Getting Started

1. Install the extension
2. Set your Claude API key in the extension settings
3. Open a C/AL or AL file
4. Use the commands from the command palette (Ctrl+Shift+P)

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
    "systemPrompt": "You are an expert AL and C/AL programming assistant. You help developers convert legacy C/AL code to modern AL code for Business Central.",
    "userPrompt": "Please convert the following C/AL code to AL:\n\n{{code}}",
    "example": "OnOpenPage()\nBEGIN\n  CurrForm.UPDATE;\nEND;"
  },
  {
    "commandName": "reviewALCode",
    "commandDescription": "Review AL code for best practices",
    "systemPrompt": "You are an AL code reviewer specializing in Business Central best practices.",
    "userPrompt": "Review the following AL code and suggest improvements for performance and readability:\n\n{{code}}",
    "example": ""
  },
  {
    "commandName": "explainComplexLogic",
    "commandDescription": "Explain complex logic using Opus model",
    "model": "claude-3-opus-20240229",
    "systemPrompt": "You are an expert AL code explainer for Microsoft Dynamics 365 Business Central.",
    "userPrompt": "Explain in detail how the following complex algorithm works:\n\n{{code}}",
    "example": ""
  },
  {
    "commandName": "quickFormat",
    "commandDescription": "Quick code formatting using Haiku model",
    "model": "claude-3-haiku-20240307",
    "systemPrompt": "You are a code formatter that improves readability without changing functionality.",
    "userPrompt": "Format and improve the indentation of this code without changing its functionality:\n\n{{code}}",
    "example": ""
  },
  {
    "commandName": "explainComplexAI",
    "commandDescription": "Use Claude 3.7 to explain complex AI concepts",
    "model": "claude-3-7-sonnet-20250219",
    "systemPrompt": "You are an AI expert with deep understanding of complex algorithms. Explain concepts clearly.",
    "userPrompt": "Explain the following algorithm as if explaining to another developer:\n\n{{code}}"
  }
]
```

Each prompt has the following properties:

- `commandName`: A unique identifier for the prompt (no spaces)
- `commandDescription`: A brief description of what the command does (shown in the selection dialog)
- `model`: (Optional) Specific Claude model to use for this prompt (dropdown selection in settings UI)
- `systemPrompt`: (Optional) Instructions for the AI about its role
- `userPrompt`: The actual prompt template. Use `{{code}}` where you want the selected code to be inserted
- `example`: (Optional) An example (not shown in the dialog but helps users understand the prompt)
- `disabled`: (Optional) A boolean to disable the prompt without removing it from the settings

**Note:** The extension will validate model names and fall back to your default model if an invalid model is specified.

**Note:** After modifying prompts in settings, you'll need to reload the window for changes to take effect.

## Documentation IDs

The extension now supports a collection of documentation references through the `bc-al-upgradeassistant.documentationIds` setting. This allows you to maintain a curated list of documentation resources for Business Central and AL development.

### Default Documentation IDs

By default, the extension includes these documentation references:

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
    "id": "CUSTOM001",
    "description": "My Company's BC Development Standards",
    "url": "https://internal-wiki.example.com/bc-standards"
  }
]
```

Each documentation ID requires:

- `id`: A unique identifier
- `description`: A brief description of the documentation
- `url`: (Optional) Link to the documentation resource
