codeunit 50100 "Test Codeunit 1 Transformation"
{
    procedure TestCodeunit1Methods()
    begin
        // These are examples of Codeunit 1 method calls that should be transformed

        // LogInManagement (Codeunit 40)
        CompanyClose();
        CompanyOpen();
        GetSystemIndicator();

        // Application System Constants (Codeunit 9015)
        ApplicationVersion();
        ReleaseVersion();
        ApplicationBuild();

        // TextManagement (Codeunit 41)
        MakeDateTimeText();
        GetSeparateDateTime();
        MakeDateText();
        MakeTimeText();
        MakeText();
        MakeDateTimeFilter();
        MakeDateFilter();
        MakeTextFilter();
        MakeCodeFilter();
        MakeTimeFilter();

        // ReportManagement (Codeunit 44)
        FindPrinter();
        HasCustomLayout();
        MergeDocument();
        ReportGetCustomRdlc();
        ReportScheduler();

        // LanguageManagement (Codeunit 43)
        ApplicationLanguage();
        SetGlobalLanguage();
        ValidateApplicationlLanguage();
        LookupApplicationlLanguage();

        // AutoFormatManagement (Codeunit 45)
        AutoFormatTranslate();
        ReadRounding();

        // CaptionManagement (Codeunit 42)
        CaptionClassTranslate();

        // Cue Setup (Codeunit 9701)
        GetCueStyle();

        // GlobalTriggerManagement (Codeunit 49)
        GetGlobalTableTriggerMask();
        OnGlobalInsert();
        OnGlobalModify();
        OnGlobalDelete();
        OnGlobalRename();
        GetDatabaseTableTriggerSetup();
        OnDatabaseInsert();
        OnDatabaseModify();
        OnDatabaseDelete();
        OnDatabaseRename();

        // Conf./Personalization Mgt. (Codeunit 9170)
        DefaultRoleCenter();
        OpenSettings();

        // SaaS Log In Management (Codeunit 50)
        OpenContactMSSales();

        // ExtensionMarketplaceMgmt (Codeunit 2501)
        InvokeExtensionInstallation();

        // Generic Chart Mgt (Codeunit 9180)
        CustomizeChart();

        // Edit MS Word Report Layout (Codeunit 9650)
        OnAfterReportGetCustomRdlc();

        // Upgrade Management (Codeunit 9900)
        OnCheckPreconditionsPerDatabase();
        OnCheckPreconditionsPerCompany();
        OnUpgradePerDatabase();
        OnUpgradePerCompany();
        OnValidateUpgradePerDatabase();
        OnValidateUpgradePerCompany();

        // Special case (Codeunit 6710)
        OnEditInExcel();

        // Methods with parameters
        MakeDateText(Today());
        MakeTimeText(Time());
        MakeText('Hello World');
        MakeDateTimeFilter(Today(), Time());
    end;

    procedure TestMethodsWithoutDirectReplacements()
    begin
        // These methods don't have direct replacements - will show info only
        CustomApplicationVersion();
        CustomApplicationBuild();
        OnDebuggerBreak();
        LaunchDebugger();
        OnInstallAppPerDatabase();
        OnInstallAppPerCompany();
    end;
}
