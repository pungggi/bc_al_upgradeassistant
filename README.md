# AL Extension Info

This extension provides hover information about extended objects in AL code and tools to assist with AL upgrades.

## Features

- Hover over `extends` object to see details about the base object
- Supports symbols from `.alpackages` folder for complete reference information
- Split CAL objects from older Business Central versions

## Usage

### Extension Info Hover

1. Open an AL file containing extension objects
2. Hover over the `extends` object to see information about the extended object

### Split CAL Objects

1. Open the command palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Run the command "AL: Split CAL Objects"
3. Follow the prompts to select source files and splitting options

## Commands

- **AL: Refresh Extension Info Cache** - Manually refresh the extension info cache
- **AL: Split CAL Objects** (`bc-al-upgradeassistant.splitCalObjects`) - Split CAL objects from older BC versions for reference or migration

## Claude AI Integration

The BC/AL Upgrade Assistant includes AI-powered assistance via Claude API. To use this feature:

### Setup

1. Obtain a Claude API key from [Anthropic](https://console.anthropic.com/)
2. Add your API key in VS Code settings:
   - Go to Settings > Extensions > BC/AL Upgrade Assistant
   - Enter your API key in the "Claude API Key" field

### Configuring Prompts

You can customize the AI prompts through the settings:

```json
"bc-al-upgradeassistant.claude.prompts": [
  {
    "commandName": "convertCALToAL",
    "systemPrompt": "You are an expert AL and C/AL programming assistant. You help developers convert legacy C/AL code to modern AL code for Business Central.",
    "userPrompt": "Please convert the following C/AL code to AL:\n\n{{code}}",
    "example": "OnOpenPage()\nBEGIN\n  CurrForm.UPDATE;\nEND;"
  },
  {
    "commandName": "reviewALCode",
    "systemPrompt": "You are an AL code reviewer specializing in Business Central best practices.",
    "userPrompt": "Review the following AL code and suggest improvements for performance and readability:\n\n{{code}}",
    "example": ""
  }
]
```
