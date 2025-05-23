report 50100 "Test Report"
{
    UsageCategory = ReportsAndAnalysis;
    ApplicationArea = All;
    
    dataset
    {
        dataitem(Customer; Customer)
        {
            column(No; "No.")
            {
            }
            column(Name; Name)
            {
            }
        }
    }
    
    rendering
    {
        layout(RDLCLayout)
        {
            Type = RDLC;
            LayoutFile = 'src/layouts/TestReport.rdl';
            Caption = 'Test RDLC Layout';
        }
        layout(WordLayout)
        {
            Type = Word;
            LayoutFile = 'src/layouts/TestReport.docx';
            Caption = 'Test Word Layout';
        }
    }
}

reportextension 50101 "Test Report Extension" extends "Customer List"
{
    rendering
    {
        layout(CustomLayout)
        {
            Type = RDLC;
            LayoutFile = 'src/layouts/CustomReport.rdl';
            Caption = 'Custom RDLC Layout';
        }
    }
}

pageextension 50102 "Test Page Extension" extends "Customer Card"
{
    layout
    {
        addafter(Name)
        {
            field(TestField; "Test Field")
            {
                ApplicationArea = All;
            }
        }
    }
}
