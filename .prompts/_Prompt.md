need to enhancement to the view under "Documenation References".
add a grouping.
group by taksId.
how to identifiy a taskId

Lets asume the documentationId in the setting is `#ICCH103`.
Then there is this line:

```txt
//BeginSometextBlabla#ICCH103/99:400077 18.08.21 YAVEON.MSC
```

The taskId is the rest of the text till a space.
in our example:
`/99:400077`

Second example:

```txt
END;  //#ICCH103/99:400077 18.08.21 YAVEON.MSC
```

The taskId is the rest of the text till a space.
in our second example:
`/99:400077`

Third example:

```txt
                                                   Description=#ICCH103/02:630029 23.02.18 PM.CB;
```

The taskId is the rest of the text till a space.
in our third example:
`/02:630029`
