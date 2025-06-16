const { Codeunit1TransformationProvider, CODEUNIT1_MAPPINGS } = require('../src/providers/codeunit1TransformationProvider');

describe('Codeunit1TransformationProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new Codeunit1TransformationProvider();
  });

  describe('generateTransformedCall', () => {
    it('should transform CompanyClose() correctly', () => {
      const originalLine = '        CompanyClose();';
      const methodName = 'CompanyClose';
      const mapping = CODEUNIT1_MAPPINGS[methodName];

      const result = provider.generateTransformedCall(originalLine, methodName, mapping);

      expect(result).toBe('        LogInManagement.CompanyClose();');
    });

    it('should transform ApplicationVersion() correctly', () => {
      const originalLine = '    ApplicationVersion();';
      const methodName = 'ApplicationVersion';
      const mapping = CODEUNIT1_MAPPINGS[methodName];

      const result = provider.generateTransformedCall(originalLine, methodName, mapping);

      expect(result).toBe('    ApplicationSystemConstants.ApplicationVersion();');
    });

    it('should transform method calls with parameters', () => {
      const originalLine = '    MakeDateText(Today());';
      const methodName = 'MakeDateText';
      const mapping = CODEUNIT1_MAPPINGS[methodName];

      const result = provider.generateTransformedCall(originalLine, methodName, mapping);

      expect(result).toBe('    TextManagement.MakeDateText(Today());');
    });

    it('should transform method calls with multiple parameters', () => {
      const originalLine = '    MakeDateTimeFilter(Today(), Time());';
      const methodName = 'MakeDateTimeFilter';
      const mapping = CODEUNIT1_MAPPINGS[methodName];

      const result = provider.generateTransformedCall(originalLine, methodName, mapping);

      expect(result).toBe('    TextManagement.MakeDateTimeFilter(Today(), Time());');
    });
  });

  describe('generateVariableDeclaration', () => {
    it('should generate correct variable declaration for LogInManagement', () => {
      const mapping = CODEUNIT1_MAPPINGS['CompanyClose'];

      const result = provider.generateVariableDeclaration(mapping);

      expect(result).toBe('LogInManagement: Codeunit 40;');
    });

    it('should generate correct variable declaration for ApplicationSystemConstants', () => {
      const mapping = CODEUNIT1_MAPPINGS['ApplicationVersion'];

      const result = provider.generateVariableDeclaration(mapping);

      expect(result).toBe('ApplicationSystemConstants: Codeunit 9015;');
    });

    it('should generate correct variable declaration for TextManagement', () => {
      const mapping = CODEUNIT1_MAPPINGS['MakeDateText'];

      const result = provider.generateVariableDeclaration(mapping);

      expect(result).toBe('TextManagement: Codeunit 41;');
    });
  });

  describe('CODEUNIT1_MAPPINGS', () => {
    it('should contain the first three required transformations', () => {
      expect(CODEUNIT1_MAPPINGS['CompanyClose']).toBeDefined();
      expect(CODEUNIT1_MAPPINGS['CompanyOpen']).toBeDefined();
      expect(CODEUNIT1_MAPPINGS['ApplicationVersion']).toBeDefined();
    });

    it('should have correct mapping for CompanyClose', () => {
      const mapping = CODEUNIT1_MAPPINGS['CompanyClose'];
      expect(mapping.newCodeunit).toBe('LogInManagement');
      expect(mapping.newMethod).toBe('CompanyClose');
      expect(mapping.codeunitId).toBe(40);
    });

    it('should have correct mapping for ApplicationVersion', () => {
      const mapping = CODEUNIT1_MAPPINGS['ApplicationVersion'];
      expect(mapping.newCodeunit).toBe('ApplicationSystemConstants');
      expect(mapping.newMethod).toBe('ApplicationVersion');
      expect(mapping.codeunitId).toBe(9015);
    });

    it('should handle MakeCodeFilter special case', () => {
      const mapping = CODEUNIT1_MAPPINGS['MakeCodeFilter'];
      expect(mapping.newCodeunit).toBe('TextManagement');
      expect(mapping.newMethod).toBe('MakeTextFilter'); // MakeCodeFilter maps to MakeTextFilter
      expect(mapping.codeunitId).toBe(41);
    });

    it('should contain all ReportManagement transformations', () => {
      expect(CODEUNIT1_MAPPINGS['FindPrinter']).toBeDefined();
      expect(CODEUNIT1_MAPPINGS['HasCustomLayout']).toBeDefined();
      expect(CODEUNIT1_MAPPINGS['MergeDocument']).toBeDefined();
      expect(CODEUNIT1_MAPPINGS['ReportGetCustomRdlc']).toBeDefined();
      expect(CODEUNIT1_MAPPINGS['ReportScheduler']).toBeDefined();
    });

    it('should have correct mapping for FindPrinter', () => {
      const mapping = CODEUNIT1_MAPPINGS['FindPrinter'];
      expect(mapping.newCodeunit).toBe('ReportManagement');
      expect(mapping.newMethod).toBe('GetPrinterName'); // FindPrinter maps to GetPrinterName
      expect(mapping.codeunitId).toBe(44);
    });

    it('should contain all GlobalTriggerManagement transformations', () => {
      expect(CODEUNIT1_MAPPINGS['GetGlobalTableTriggerMask']).toBeDefined();
      expect(CODEUNIT1_MAPPINGS['OnGlobalInsert']).toBeDefined();
      expect(CODEUNIT1_MAPPINGS['OnDatabaseInsert']).toBeDefined();
      expect(CODEUNIT1_MAPPINGS['OnDatabaseModify']).toBeDefined();
    });

    it('should handle methods without direct replacements', () => {
      expect(CODEUNIT1_MAPPINGS['CustomApplicationVersion']).toBeDefined();
      expect(CODEUNIT1_MAPPINGS['OnDebuggerBreak']).toBeDefined();
      expect(CODEUNIT1_MAPPINGS['LaunchDebugger']).toBeDefined();

      const mapping = CODEUNIT1_MAPPINGS['CustomApplicationVersion'];
      expect(mapping.newCodeunit).toBe('N/A');
      expect(mapping.isEvent).toBe(true);
    });

    it('should contain upgrade management transformations', () => {
      expect(CODEUNIT1_MAPPINGS['OnUpgradePerDatabase']).toBeDefined();
      expect(CODEUNIT1_MAPPINGS['OnUpgradePerCompany']).toBeDefined();
      expect(CODEUNIT1_MAPPINGS['OnValidateUpgradePerDatabase']).toBeDefined();

      const mapping = CODEUNIT1_MAPPINGS['OnUpgradePerDatabase'];
      expect(mapping.newCodeunit).toBe('UpgradeManagement');
      expect(mapping.codeunitId).toBe(9900);
    });
  });
});

// Mock console methods for testing
global.console = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
};
