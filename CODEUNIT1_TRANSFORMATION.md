# Codeunit 1 Transformation Feature

## Overview

This feature provides Code Actions to transform legacy Codeunit 1 method calls to their new equivalents in Business Central. When upgrading from older NAV versions, Codeunit 1 (Application Management) has been removed and replaced with new System codeunits.

## Background

With Business Central, codeunit 1 Application Management has been removed and replaced with new System codeunits. No functionality has been removed by this change. All system method triggers, event publishers, and their code have been moved to other codeunits.

## Supported Transformations

### Complete Implementation - All Codeunit 1 Methods

This implementation includes **ALL** Codeunit 1 method transformations from the Microsoft documentation:

#### LogInManagement (Codeunit 40)
- `CompanyClose()` → `LogInManagement.CompanyClose()`
- `CompanyOpen()` → `LogInManagement.CompanyOpen()`
- `GetSystemIndicator()` → `LogInManagement.GetSystemIndicator()`

#### Application System Constants (Codeunit 9015)
- `ApplicationVersion()` → `ApplicationSystemConstants.ApplicationVersion()`
- `ReleaseVersion()` → `ApplicationSystemConstants.ReleaseVersion()`
- `ApplicationBuild()` → `ApplicationSystemConstants.ApplicationBuild()`

#### TextManagement (Codeunit 41)
- `MakeDateTimeText()` → `TextManagement.MakeDateTimeText()`
- `GetSeparateDateTime()` → `TextManagement.GetSeparateDateTime()`
- `MakeDateText()` → `TextManagement.MakeDateText()`
- `MakeTimeText()` → `TextManagement.MakeTimeText()`
- `MakeText()` → `TextManagement.MakeText()`
- `MakeDateTimeFilter()` → `TextManagement.MakeDateTimeFilter()`
- `MakeDateFilter()` → `TextManagement.MakeDateFilter()`
- `MakeTextFilter()` → `TextManagement.MakeTextFilter()`
- `MakeCodeFilter()` → `TextManagement.MakeTextFilter()` (Note: MakeCodeFilter maps to MakeTextFilter)
- `MakeTimeFilter()` → `TextManagement.MakeTimeFilter()`

#### ReportManagement (Codeunit 44)
- `FindPrinter()` → `ReportManagement.GetPrinterName()`
- `HasCustomLayout()` → `ReportManagement.HasCustomLayout()`
- `MergeDocument()` → `ReportManagement.MergeDocument()`
- `ReportGetCustomRdlc()` → `ReportManagement.ReportGetCustomRdlc()`
- `ReportScheduler()` → `ReportManagement.ScheduleReport()`

#### LanguageManagement (Codeunit 43)
- `ApplicationLanguage()` → `LanguageManagement.ApplicationLanguage()`
- `SetGlobalLanguage()` → `LanguageManagement.SetGlobalLanguage()`
- `ValidateApplicationlLanguage()` → `LanguageManagement.ValidateApplicationLanguage()`
- `LookupApplicationlLanguage()` → `LanguageManagement.LookupApplicationLanguage()`

#### AutoFormatManagement (Codeunit 45)
- `AutoFormatTranslate()` → `AutoFormatManagement.AutoFormatTranslate()`
- `ReadRounding()` → `AutoFormatManagement.ReadRounding()`

#### CaptionManagement (Codeunit 42)
- `CaptionClassTranslate()` → `CaptionManagement.CaptionClassTranslate()`

#### Cue Setup (Codeunit 9701)
- `GetCueStyle()` → `CueSetup.GetCueStyle()`

#### GlobalTriggerManagement (Codeunit 49)
- `GetGlobalTableTriggerMask()` → `GlobalTriggerManagement.GetGlobalTableTriggerMask()`
- `OnGlobalInsert()` → `GlobalTriggerManagement.OnGlobalInsert()`
- `OnGlobalModify()` → `GlobalTriggerManagement.OnGlobalModify()`
- `OnGlobalDelete()` → `GlobalTriggerManagement.OnGlobalDelete()`
- `OnGlobalRename()` → `GlobalTriggerManagement.OnGlobalRename()`
- `GetDatabaseTableTriggerSetup()` → `GlobalTriggerManagement.GetDatabaseTableTriggerSetup()`
- `OnDatabaseInsert()` → `GlobalTriggerManagement.OnDatabaseInsert()`
- `OnDatabaseModify()` → `GlobalTriggerManagement.OnDatabaseModify()`
- `OnDatabaseDelete()` → `GlobalTriggerManagement.OnDatabaseDelete()`
- `OnDatabaseRename()` → `GlobalTriggerManagement.OnDatabaseRename()`

#### Conf./Personalization Mgt. (Codeunit 9170)
- `DefaultRoleCenter()` → `ConfPersonalizationMgt.DefaultRoleCenterID()`
- `OpenSettings()` → `ConfPersonalizationMgt.OpenSettings()`

#### SaaS Log In Management (Codeunit 50)
- `OpenContactMSSales()` → `SaaSLogInManagement.OpenContactMSSales()`

#### ExtensionMarketplaceMgmt (Codeunit 2501)
- `InvokeExtensionInstallation()` → `ExtensionMarketplaceMgmt.InvokeExtensionInstallation()`

#### Generic Chart Mgt (Codeunit 9180)
- `CustomizeChart()` → `GenericChartMgt.CustomizeChart()`

#### Edit MS Word Report Layout (Codeunit 9650)
- `OnAfterReportGetCustomRdlc()` → `EditMSWordReportLayout.OnAfterReportGetCustomRdlc()`

#### Upgrade Management (Codeunit 9900)
- `OnCheckPreconditionsPerDatabase()` → `UpgradeManagement.OnCheckPreconditionsPerDatabase()`
- `OnCheckPreconditionsPerCompany()` → `UpgradeManagement.RaiseOnCheckPreconditionsPerCompany()`
- `OnUpgradePerDatabase()` → `UpgradeManagement.OnUpgradePerDatabase()`
- `OnUpgradePerCompany()` → `UpgradeManagement.OnUpgradePerCompany()`
- `OnValidateUpgradePerDatabase()` → `UpgradeManagement.OnValidateUpgradePerDatabase()`
- `OnValidateUpgradePerCompany()` → `UpgradeManagement.OnValidateUpgradePerCompany()`

#### Special Cases (Codeunit 6710)
- `OnEditInExcel()` → `OnEditInExcel.OnEditInExcel()`

### Methods Without Direct Replacements

These methods are marked as N/A in the Microsoft documentation and provide information only:

- `CustomApplicationVersion()` - No direct replacement, use events or custom implementation
- `CustomApplicationBuild()` - No direct replacement, use events or custom implementation
- `OnDebuggerBreak()` - Functionality removed
- `LaunchDebugger()` - Functionality removed
- `OnInstallAppPerDatabase()` - Use app lifecycle events
- `OnInstallAppPerCompany()` - Use app lifecycle events

## How to Use

1. **Open an AL file** containing Codeunit 1 method calls
2. **Position your cursor** on a line with a Codeunit 1 method call
3. **Trigger Code Actions** (Ctrl+. or Cmd+. or click the lightbulb icon)
4. **Select one of the available actions**:
   - **Transform to [NewCodeunit].[NewMethod]** - Automatically replaces the method call
   - **Copy [NewCodeunit].[NewMethod] info** - Copies transformation information to clipboard

## Code Actions Available

### Transform Action
- Automatically replaces the old method call with the new equivalent
- Shows a notification with the transformation details
- Prompts to copy the required variable declaration

### Copy Info Action
- Copies detailed transformation information to clipboard including:
  - Original method call
  - New method call
  - Required variable declaration
  - Codeunit information

## Variable Declarations Required

After transforming method calls, you need to add the appropriate variable declarations:

```al
var
    // Core Management Codeunits
    LogInManagement: Codeunit 40;
    ApplicationSystemConstants: Codeunit 9015;
    TextManagement: Codeunit 41;
    CaptionManagement: Codeunit 42;
    LanguageManagement: Codeunit 43;
    ReportManagement: Codeunit 44;
    AutoFormatManagement: Codeunit 45;
    GlobalTriggerManagement: Codeunit 49;
    SaaSLogInManagement: Codeunit 50;

    // Specialized Codeunits
    OnEditInExcel: Codeunit 6710;
    ConfPersonalizationMgt: Codeunit 9170;
    GenericChartMgt: Codeunit 9180;
    EditMSWordReportLayout: Codeunit 9650;
    CueSetup: Codeunit 9701;
    UpgradeManagement: Codeunit 9900;
    ExtensionMarketplaceMgmt: Codeunit 2501;
```

## Example

### Before Transformation:
```al
procedure TestMethod()
begin
    // Company management
    CompanyClose();
    CompanyOpen();

    // Application info
    ApplicationVersion();
    ApplicationBuild();

    // Text formatting
    MakeDateText(Today());
    MakeTimeText(Time());

    // Report management
    FindPrinter();
    HasCustomLayout();

    // Language management
    ApplicationLanguage();
    SetGlobalLanguage();

    // Auto formatting
    AutoFormatTranslate();

    // Global triggers
    OnGlobalInsert();
    GetGlobalTableTriggerMask();
end;
```

### After Transformation:
```al
var
    LogInManagement: Codeunit 40;
    ApplicationSystemConstants: Codeunit 9015;
    TextManagement: Codeunit 41;
    ReportManagement: Codeunit 44;
    LanguageManagement: Codeunit 43;
    AutoFormatManagement: Codeunit 45;
    GlobalTriggerManagement: Codeunit 49;

procedure TestMethod()
begin
    // Company management
    LogInManagement.CompanyClose();
    LogInManagement.CompanyOpen();

    // Application info
    ApplicationSystemConstants.ApplicationVersion();
    ApplicationSystemConstants.ApplicationBuild();

    // Text formatting
    TextManagement.MakeDateText(Today());
    TextManagement.MakeTimeText(Time());

    // Report management
    ReportManagement.GetPrinterName();
    ReportManagement.HasCustomLayout();

    // Language management
    LanguageManagement.ApplicationLanguage();
    LanguageManagement.SetGlobalLanguage();

    // Auto formatting
    AutoFormatManagement.AutoFormatTranslate();

    // Global triggers
    GlobalTriggerManagement.OnGlobalInsert();
    GlobalTriggerManagement.GetGlobalTableTriggerMask();
end;
```

## Testing

Use the provided test file `test-codeunit1-transformation.al` to test the transformations. This file contains examples of all supported Codeunit 1 method calls.

## Microsoft Documentation Reference

This implementation is based on the official Microsoft documentation:
[Transitioning from Codeunit 1 to System Codeunits](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/upgrade/transitioning-from-codeunit1)

## Future Enhancements

Additional transformations can be added by extending the `CODEUNIT1_MAPPINGS` object in `src/providers/codeunit1TransformationProvider.js`.
