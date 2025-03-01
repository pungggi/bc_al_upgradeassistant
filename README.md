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
