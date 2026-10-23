bump: patch

### Fixed
- Windows : les chemins rendus par git (`C:/…`) sont normalisés en `C:\…` et comparés sans casse — un dépôt n'apparaît plus deux fois dans la liste, la garde de diff accepte les deux formes
