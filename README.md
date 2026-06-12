src/lib/
├── adapters/                # Infraestructura externa (Bajo nivel)
│   ├── google-sheet.provider.ts
│   └── postgres.provider.ts
├── core/                    # Lógica de coordinación (Orquestación)
│   └── data-source-manager.ts
├── interfaces/              # Contratos (Lo que une todo)
│   └── provider.interface.ts
├── sheet-odm.module.ts      # Registro y exportación
└── index.ts                 # API pública de la librería