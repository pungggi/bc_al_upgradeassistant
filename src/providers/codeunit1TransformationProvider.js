const vscode = require("vscode");

/**
 * Mapping of Codeunit 1 methods to their new equivalents
 * Based on Microsoft documentation for transitioning from Codeunit 1 to System Codeunits
 */
const CODEUNIT1_MAPPINGS = {
  // LogInManagement (Codeunit 40)
  CompanyClose: {
    newCodeunit: "LogInManagement",
    newMethod: "CompanyClose",
    codeunitId: 40,
    description: "Transform CompanyClose to LogInManagement.CompanyClose"
  },
  CompanyOpen: {
    newCodeunit: "LogInManagement",
    newMethod: "CompanyOpen",
    codeunitId: 40,
    description: "Transform CompanyOpen to LogInManagement.CompanyOpen"
  },
  GetSystemIndicator: {
    newCodeunit: "LogInManagement",
    newMethod: "GetSystemIndicator",
    codeunitId: 40,
    description: "Transform GetSystemIndicator to LogInManagement.GetSystemIndicator"
  },

  // Application System Constants (Codeunit 9015)
  ApplicationVersion: {
    newCodeunit: "ApplicationSystemConstants",
    newMethod: "ApplicationVersion",
    codeunitId: 9015,
    description: "Transform ApplicationVersion to ApplicationSystemConstants.ApplicationVersion"
  },
  ReleaseVersion: {
    newCodeunit: "ApplicationSystemConstants",
    newMethod: "ReleaseVersion",
    codeunitId: 9015,
    description: "Transform ReleaseVersion to ApplicationSystemConstants.ReleaseVersion"
  },
  ApplicationBuild: {
    newCodeunit: "ApplicationSystemConstants",
    newMethod: "ApplicationBuild",
    codeunitId: 9015,
    description: "Transform ApplicationBuild to ApplicationSystemConstants.ApplicationBuild"
  },

  // TextManagement (Codeunit 41)
  MakeDateTimeText: {
    newCodeunit: "TextManagement",
    newMethod: "MakeDateTimeText",
    codeunitId: 41,
    description: "Transform MakeDateTimeText to TextManagement.MakeDateTimeText"
  },
  GetSeparateDateTime: {
    newCodeunit: "TextManagement",
    newMethod: "GetSeparateDateTime",
    codeunitId: 41,
    description: "Transform GetSeparateDateTime to TextManagement.GetSeparateDateTime"
  },
  MakeDateText: {
    newCodeunit: "TextManagement",
    newMethod: "MakeDateText",
    codeunitId: 41,
    description: "Transform MakeDateText to TextManagement.MakeDateText"
  },
  MakeTimeText: {
    newCodeunit: "TextManagement",
    newMethod: "MakeTimeText",
    codeunitId: 41,
    description: "Transform MakeTimeText to TextManagement.MakeTimeText"
  },
  MakeText: {
    newCodeunit: "TextManagement",
    newMethod: "MakeText",
    codeunitId: 41,
    description: "Transform MakeText to TextManagement.MakeText"
  },
  MakeDateTimeFilter: {
    newCodeunit: "TextManagement",
    newMethod: "MakeDateTimeFilter",
    codeunitId: 41,
    description: "Transform MakeDateTimeFilter to TextManagement.MakeDateTimeFilter"
  },
  MakeDateFilter: {
    newCodeunit: "TextManagement",
    newMethod: "MakeDateFilter",
    codeunitId: 41,
    description: "Transform MakeDateFilter to TextManagement.MakeDateFilter"
  },
  MakeTextFilter: {
    newCodeunit: "TextManagement",
    newMethod: "MakeTextFilter",
    codeunitId: 41,
    description: "Transform MakeTextFilter to TextManagement.MakeTextFilter"
  },
  MakeCodeFilter: {
    newCodeunit: "TextManagement",
    newMethod: "MakeTextFilter", // Note: MakeCodeFilter maps to MakeTextFilter
    codeunitId: 41,
    description: "Transform MakeCodeFilter to TextManagement.MakeTextFilter"
  },
  MakeTimeFilter: {
    newCodeunit: "TextManagement",
    newMethod: "MakeTimeFilter",
    codeunitId: 41,
    description: "Transform MakeTimeFilter to TextManagement.MakeTimeFilter"
  },

  // ReportManagement (Codeunit 44)
  FindPrinter: {
    newCodeunit: "ReportManagement",
    newMethod: "GetPrinterName",
    codeunitId: 44,
    description: "Transform FindPrinter to ReportManagement.GetPrinterName"
  },
  HasCustomLayout: {
    newCodeunit: "ReportManagement",
    newMethod: "HasCustomLayout",
    codeunitId: 44,
    description: "Transform HasCustomLayout to ReportManagement.HasCustomLayout"
  },
  MergeDocument: {
    newCodeunit: "ReportManagement",
    newMethod: "MergeDocument",
    codeunitId: 44,
    description: "Transform MergeDocument to ReportManagement.MergeDocument"
  },
  ReportGetCustomRdlc: {
    newCodeunit: "ReportManagement",
    newMethod: "ReportGetCustomRdlc",
    codeunitId: 44,
    description: "Transform ReportGetCustomRdlc to ReportManagement.ReportGetCustomRdlc"
  },
  ReportScheduler: {
    newCodeunit: "ReportManagement",
    newMethod: "ScheduleReport",
    codeunitId: 44,
    description: "Transform ReportScheduler to ReportManagement.ScheduleReport"
  },

  // LanguageManagement (Codeunit 43)
  ApplicationLanguage: {
    newCodeunit: "LanguageManagement",
    newMethod: "ApplicationLanguage",
    codeunitId: 43,
    description: "Transform ApplicationLanguage to LanguageManagement.ApplicationLanguage"
  },
  SetGlobalLanguage: {
    newCodeunit: "LanguageManagement",
    newMethod: "SetGlobalLanguage",
    codeunitId: 43,
    description: "Transform SetGlobalLanguage to LanguageManagement.SetGlobalLanguage"
  },
  ValidateApplicationlLanguage: {
    newCodeunit: "LanguageManagement",
    newMethod: "ValidateApplicationLanguage",
    codeunitId: 43,
    description: "Transform ValidateApplicationlLanguage to LanguageManagement.ValidateApplicationLanguage"
  },
  LookupApplicationlLanguage: {
    newCodeunit: "LanguageManagement",
    newMethod: "LookupApplicationLanguage",
    codeunitId: 43,
    description: "Transform LookupApplicationlLanguage to LanguageManagement.LookupApplicationLanguage"
  },

  // AutoFormatManagement (Codeunit 45)
  AutoFormatTranslate: {
    newCodeunit: "AutoFormatManagement",
    newMethod: "AutoFormatTranslate",
    codeunitId: 45,
    description: "Transform AutoFormatTranslate to AutoFormatManagement.AutoFormatTranslate"
  },
  ReadRounding: {
    newCodeunit: "AutoFormatManagement",
    newMethod: "ReadRounding",
    codeunitId: 45,
    description: "Transform ReadRounding to AutoFormatManagement.ReadRounding"
  },

  // CaptionManagement (Codeunit 42)
  CaptionClassTranslate: {
    newCodeunit: "CaptionManagement",
    newMethod: "CaptionClassTranslate",
    codeunitId: 42,
    description: "Transform CaptionClassTranslate to CaptionManagement.CaptionClassTranslate"
  },

  // Cue Setup (Codeunit 9701)
  GetCueStyle: {
    newCodeunit: "CueSetup",
    newMethod: "GetCueStyle",
    codeunitId: 9701,
    description: "Transform GetCueStyle to CueSetup.GetCueStyle"
  },

  // GlobalTriggerManagement (Codeunit 49)
  GetGlobalTableTriggerMask: {
    newCodeunit: "GlobalTriggerManagement",
    newMethod: "GetGlobalTableTriggerMask",
    codeunitId: 49,
    description: "Transform GetGlobalTableTriggerMask to GlobalTriggerManagement.GetGlobalTableTriggerMask"
  },
  OnGlobalInsert: {
    newCodeunit: "GlobalTriggerManagement",
    newMethod: "OnGlobalInsert",
    codeunitId: 49,
    description: "Transform OnGlobalInsert to GlobalTriggerManagement.OnGlobalInsert"
  },
  OnGlobalModify: {
    newCodeunit: "GlobalTriggerManagement",
    newMethod: "OnGlobalModify",
    codeunitId: 49,
    description: "Transform OnGlobalModify to GlobalTriggerManagement.OnGlobalModify"
  },
  OnGlobalDelete: {
    newCodeunit: "GlobalTriggerManagement",
    newMethod: "OnGlobalDelete",
    codeunitId: 49,
    description: "Transform OnGlobalDelete to GlobalTriggerManagement.OnGlobalDelete"
  },
  OnGlobalRename: {
    newCodeunit: "GlobalTriggerManagement",
    newMethod: "OnGlobalRename",
    codeunitId: 49,
    description: "Transform OnGlobalRename to GlobalTriggerManagement.OnGlobalRename"
  },
  GetDatabaseTableTriggerSetup: {
    newCodeunit: "GlobalTriggerManagement",
    newMethod: "GetDatabaseTableTriggerSetup",
    codeunitId: 49,
    description: "Transform GetDatabaseTableTriggerSetup to GlobalTriggerManagement.GetDatabaseTableTriggerSetup"
  },
  OnDatabaseInsert: {
    newCodeunit: "GlobalTriggerManagement",
    newMethod: "OnDatabaseInsert",
    codeunitId: 49,
    description: "Transform OnDatabaseInsert to GlobalTriggerManagement.OnDatabaseInsert"
  },
  OnDatabaseModify: {
    newCodeunit: "GlobalTriggerManagement",
    newMethod: "OnDatabaseModify",
    codeunitId: 49,
    description: "Transform OnDatabaseModify to GlobalTriggerManagement.OnDatabaseModify"
  },
  OnDatabaseDelete: {
    newCodeunit: "GlobalTriggerManagement",
    newMethod: "OnDatabaseDelete",
    codeunitId: 49,
    description: "Transform OnDatabaseDelete to GlobalTriggerManagement.OnDatabaseDelete"
  },
  OnDatabaseRename: {
    newCodeunit: "GlobalTriggerManagement",
    newMethod: "OnDatabaseRename",
    codeunitId: 49,
    description: "Transform OnDatabaseRename to GlobalTriggerManagement.OnDatabaseRename"
  },

  // Conf./Personalization Mgt. (Codeunit 9170)
  DefaultRoleCenter: {
    newCodeunit: "ConfPersonalizationMgt",
    newMethod: "DefaultRoleCenterID",
    codeunitId: 9170,
    description: "Transform DefaultRoleCenter to ConfPersonalizationMgt.DefaultRoleCenterID"
  },
  OpenSettings: {
    newCodeunit: "ConfPersonalizationMgt",
    newMethod: "OpenSettings",
    codeunitId: 9170,
    description: "Transform OpenSettings to ConfPersonalizationMgt.OpenSettings"
  },

  // SaaS Log In Management (Codeunit 50)
  OpenContactMSSales: {
    newCodeunit: "SaaSLogInManagement",
    newMethod: "OpenContactMSSales",
    codeunitId: 50,
    description: "Transform OpenContactMSSales to SaaSLogInManagement.OpenContactMSSales"
  },

  // ExtensionMarketplaceMgmt (Codeunit 2501)
  InvokeExtensionInstallation: {
    newCodeunit: "ExtensionMarketplaceMgmt",
    newMethod: "InvokeExtensionInstallation",
    codeunitId: 2501,
    description: "Transform InvokeExtensionInstallation to ExtensionMarketplaceMgmt.InvokeExtensionInstallation"
  },

  // Generic Chart Mgt (Codeunit 9180)
  CustomizeChart: {
    newCodeunit: "GenericChartMgt",
    newMethod: "CustomizeChart",
    codeunitId: 9180,
    description: "Transform CustomizeChart to GenericChartMgt.CustomizeChart"
  },

  // Edit MS Word Report Layout (Codeunit 9650)
  OnAfterReportGetCustomRdlc: {
    newCodeunit: "EditMSWordReportLayout",
    newMethod: "OnAfterReportGetCustomRdlc",
    codeunitId: 9650,
    description: "Transform OnAfterReportGetCustomRdlc to EditMSWordReportLayout.OnAfterReportGetCustomRdlc"
  },

  // Upgrade Management (Codeunit 9900)
  OnCheckPreconditionsPerDatabase: {
    newCodeunit: "UpgradeManagement",
    newMethod: "OnCheckPreconditionsPerDatabase",
    codeunitId: 9900,
    description: "Transform OnCheckPreconditionsPerDatabase to UpgradeManagement.OnCheckPreconditionsPerDatabase"
  },
  OnCheckPreconditionsPerCompany: {
    newCodeunit: "UpgradeManagement",
    newMethod: "RaiseOnCheckPreconditionsPerCompany",
    codeunitId: 9900,
    description: "Transform OnCheckPreconditionsPerCompany to UpgradeManagement.RaiseOnCheckPreconditionsPerCompany"
  },
  OnUpgradePerDatabase: {
    newCodeunit: "UpgradeManagement",
    newMethod: "OnUpgradePerDatabase",
    codeunitId: 9900,
    description: "Transform OnUpgradePerDatabase to UpgradeManagement.OnUpgradePerDatabase"
  },
  OnUpgradePerCompany: {
    newCodeunit: "UpgradeManagement",
    newMethod: "OnUpgradePerCompany",
    codeunitId: 9900,
    description: "Transform OnUpgradePerCompany to UpgradeManagement.OnUpgradePerCompany"
  },
  OnValidateUpgradePerDatabase: {
    newCodeunit: "UpgradeManagement",
    newMethod: "OnValidateUpgradePerDatabase",
    codeunitId: 9900,
    description: "Transform OnValidateUpgradePerDatabase to UpgradeManagement.OnValidateUpgradePerDatabase"
  },
  OnValidateUpgradePerCompany: {
    newCodeunit: "UpgradeManagement",
    newMethod: "OnValidateUpgradePerCompany",
    codeunitId: 9900,
    description: "Transform OnValidateUpgradePerCompany to UpgradeManagement.OnValidateUpgradePerCompany"
  },

  // Special case for OnEditInExcel (Codeunit 6710)
  OnEditInExcel: {
    newCodeunit: "OnEditInExcel",
    newMethod: "OnEditInExcel",
    codeunitId: 6710,
    description: "Transform OnEditInExcel to OnEditInExcel.OnEditInExcel"
  },

  // Event-based methods that don't have direct replacements but have events
  // These are marked as N/A in the documentation but we provide guidance
  CustomApplicationVersion: {
    newCodeunit: "N/A",
    newMethod: "N/A",
    codeunitId: null,
    description: "CustomApplicationVersion has no direct replacement - use events or custom implementation",
    isEvent: true
  },
  CustomApplicationBuild: {
    newCodeunit: "N/A",
    newMethod: "N/A",
    codeunitId: null,
    description: "CustomApplicationBuild has no direct replacement - use events or custom implementation",
    isEvent: true
  },
  OnDebuggerBreak: {
    newCodeunit: "N/A",
    newMethod: "N/A",
    codeunitId: null,
    description: "OnDebuggerBreak has no direct replacement - functionality removed",
    isEvent: true
  },
  LaunchDebugger: {
    newCodeunit: "N/A",
    newMethod: "N/A",
    codeunitId: null,
    description: "LaunchDebugger has no direct replacement - functionality removed",
    isEvent: true
  },
  OnInstallAppPerDatabase: {
    newCodeunit: "N/A",
    newMethod: "N/A",
    codeunitId: null,
    description: "OnInstallAppPerDatabase has no direct replacement - use app lifecycle events",
    isEvent: true
  },
  OnInstallAppPerCompany: {
    newCodeunit: "N/A",
    newMethod: "N/A",
    codeunitId: null,
    description: "OnInstallAppPerCompany has no direct replacement - use app lifecycle events",
    isEvent: true
  }
};

/**
 * Provides code actions for transforming Codeunit 1 method calls to their new equivalents
 */
class Codeunit1TransformationProvider {
  /**
   * Provide code actions for the given document and range
   * @param {vscode.TextDocument} document The document in which the command was invoked
   * @param {vscode.Range | vscode.Selection} range The range or selection for which the command was invoked
   * @returns {vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]>}
   */
  provideCodeActions(document, range) {
    const line = document.lineAt(range.start.line);
    const lineText = line.text.trim();
    const actions = [];

    // Check for Codeunit 1 method calls
    // Pattern: MethodName() or MethodName(parameters)
    const methodCallMatch = lineText.match(/(\w+)\s*\([^)]*\)/);
    if (!methodCallMatch) {
      return undefined;
    }

    const methodName = methodCallMatch[1];
    const mapping = CODEUNIT1_MAPPINGS[methodName];

    if (!mapping) {
      return undefined;
    }

    // Handle special cases for methods without direct replacements
    if (mapping.isEvent || mapping.newCodeunit === "N/A") {
      // Only provide information action for methods without direct replacements
      const infoAction = new vscode.CodeAction(
        `Info: ${mapping.description}`,
        vscode.CodeActionKind.QuickFix
      );

      infoAction.command = {
        command: "bc-al-upgradeassistant.showCodeunit1Info",
        title: `Show info for ${methodName}`,
        arguments: [
          {
            methodName: methodName,
            mapping: mapping
          }
        ]
      };

      actions.push(infoAction);
      return actions;
    }

    // Create code action for transformation
    const action = new vscode.CodeAction(
      `Transform to ${mapping.newCodeunit}.${mapping.newMethod}`,
      vscode.CodeActionKind.RefactorRewrite
    );

    action.command = {
      command: "bc-al-upgradeassistant.transformCodeunit1Method",
      title: mapping.description,
      arguments: [
        {
          document: document,
          range: range,
          lineText: lineText,
          methodName: methodName,
          mapping: mapping
        }
      ]
    };

    actions.push(action);

    // Also create an action to copy the transformation info to clipboard
    const copyAction = new vscode.CodeAction(
      `Copy ${mapping.newCodeunit}.${mapping.newMethod} info`,
      vscode.CodeActionKind.QuickFix
    );

    copyAction.command = {
      command: "bc-al-upgradeassistant.copyCodeunit1TransformationInfo",
      title: `Copy transformation info for ${methodName}`,
      arguments: [
        {
          methodName: methodName,
          mapping: mapping,
          transformedCall: this.generateTransformedCall(lineText, methodName, mapping)
        }
      ]
    };

    actions.push(copyAction);

    return actions;
  }

  /**
   * Generate the transformed method call
   * @param {string} originalLine The original line of code
   * @param {string} methodName The original method name
   * @param {object} mapping The mapping configuration
   * @returns {string} The transformed method call
   */
  generateTransformedCall(originalLine, methodName, mapping) {
    // Extract parameters from the original call
    const paramMatch = originalLine.match(new RegExp(`${methodName}\\s*\\(([^)]*)\\)`));
    const parameters = paramMatch ? paramMatch[1] : '';

    // Generate the new call
    const newCall = `${mapping.newCodeunit}.${mapping.newMethod}(${parameters})`;

    // Replace the original method call with the new one
    const transformedLine = originalLine.replace(
      new RegExp(`${methodName}\\s*\\([^)]*\\)`),
      newCall
    );

    return transformedLine;
  }

  /**
   * Generate variable declaration for the new codeunit if needed
   * @param {object} mapping The mapping configuration
   * @returns {string} Variable declaration
   */
  generateVariableDeclaration(mapping) {
    return `${mapping.newCodeunit}: Codeunit ${mapping.codeunitId};`;
  }
}

module.exports = { Codeunit1TransformationProvider, CODEUNIT1_MAPPINGS };
