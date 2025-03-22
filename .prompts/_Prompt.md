#codebase in the view "BC/AL REFERENCES", Node "Documentation References" groups by taskId at the moment, this is ok, keep it.
But add new groupings:

My Comments are between ... my comment ...

1. Group all References by Procedure

Use Regex to recognize procedures:

```txt
    // ... local procedure ...
    LOCAL ...ignore what comes before...  PROCEDURE SomeName@1000000001(... maybe some parameters ...);
    VAR
      ... optional maybe some variables
    BEGIN
      //#ICCH103/03:400104 11.12.17 YAVEON.CH-MSC
      ...some code..
    END;

    // ... global procedure ...
    PROCEDURE SomeName@1000000001(... maybe some parameters ...);
    VAR
        BankAccReconciliation@1000 : Record 273;
        ... optional maybe some variables ...
    BEGIN
      //#ICCH103/03:400104 11.12.17 YAVEON.CH-MSC
      ... some code ...
    END;
```

2. Group all References by Trigger

Use Regex to recognize it:
Triggers start with `On` in a section that start with something like `PROPERTIES {` and end with `ActionList=ACTIONS` in Pages.

```txt
  PROPERTIES
  {
    ... some=properties ...
    OnAfterGetRecord=VAR
                       PaymentMatchingDetails@1000 : Record 1299;
                     BEGIN
                        //#ICCH103/03:400104 11.12.17 YAVEON.CH-MSC
                                 ... some code ...
                     END;

    OnNewRecord=BEGIN
                   //#ICCH103/03:400104 11.12.17 YAVEON.CH-MSC
                                 ... some code ...
                END;

    OnAfterGetCurrRecord=BEGIN
                           //#ICCH103/03:400104 11.12.17 YAVEON.CH-MSC
                                 ... some code ...
                         END;

    ActionList=ACTIONS
```

Triggers start with `On` in a section that start with something like `PROPERTIES {` and end with `}` of the Properties in all other objects.

```txt
 PROPERTIES
  {
    ... maybe some=properties ...
    OnInitReport=BEGIN
                    //#ICCH103/03:400104 11.12.17 YAVEON.CH-MSC
                                 ... some code ...
                 END;

    OnPreReport=BEGIN
                   //#ICCH103/03:400104 11.12.17 YAVEON.CH-MSC
                                 ... some code ...
                END;

    OnPostReport=BEGIN
                    //#ICCH103/03:400104 11.12.17 YAVEON.CH-MSC
                                 ... some code ...
                 END;

  }

  // 3 triggers: OnInitReport, OnPreReport, OnPostReport
```

3. Group all References by Actions

```txt
      { 29      ;1   ;Action    ;
                      Name=ApplyAutomatically;
                      CaptionML=[ENU=Apply Automatically;
                                 DES=Automatisch ausgleichen;
                                 ITS=Collega automaticamente;
                                 FRS=Lettrer automatiquement];
                      RunPageOnRec=Yes;
                      Promoted=Yes;
                      PromotedIsBig=Yes;
                      Image=MapAccounts;
                      PromotedCategory=Process;
                      OnAction=VAR
                                 BankAccReconciliation@1000 : Record 273;
                                 ... optional maybe some variables ...
                               BEGIN
                                 //#ICCH103/03:400104 11.12.17 YAVEON.CH-MSC
                                 ... some code ...
                               END;
                                }
```

4. Group all References by Fields

```txt
    { 51000;  ;Print PZN for Ship-to;Option       ;CaptionML=[ENU=Print PZN for Ship-to;
                                                              DES=PZN drucken f r Lief. an];
                                                   OptionCaptionML=[ENU=No,Item Pharmacode,ESCM ID PZN,PZN for Ship-to Country;
                                                                    DES=Nein,Artikel Pharmacode,ESCM ID PZN,PZN f r Lief. an Land];
                                                   OptionString=No,Item Pharmacode,ESCM ID PZN,PZN for Ship-to Country;
                                                   Description=#ICCH103/99:400056 18.06.20 YAVEON.MSC }
```

```txt
    { 51000;  ;Item Release Entry No.;BigInteger  ;OnValidate=VAR
                                                                lItemRelease@50000 : Record 50002;
                                                              BEGIN
                                                                //#ICCH103/02:610336 09.08.18 YAVEON.MSC
                                                                TestStatusOpen;
                                                                TESTFIELD(Type, Type::Item);
                                                                TESTFIELD("No.");
                                                                TESTFIELD("Buy-from Vendor No.");

                                                                lItemRelease.GetItemRelease2PurchLine(Rec, FIELDNO("Item Release Entry No."), CurrFieldNo, 0 {No LookUpPage}, TRUE {Error});
                                                              END;

                                                   OnLookup=VAR
                                                              lItemRelease@50001 : Record 50002;
                                                            BEGIN
                                                              //#ICCH103/02:610336 09.08.18 YAVEON.MSC
                                                              IF lItemRelease.LookUpItemRelease2PurchLine(Rec, FIELDNO("Item Release Entry No."), CurrFieldNo) THEN
                                                                TestStatusOpen;
                                                            END;

                                                   CaptionML=[ENU=Item Release Entry No.;
                                                              DES=Artikelfreigabe Laufnr.];
                                                   BlankZero=Yes;
                                                   Description=#ICCH103/02:610336 09.08.18 YAVEON.MSC }
```

Enhance, reuse exsting code like calParser.js, alCodeFilter.js, objectExtractor.js is it makes sense.
