// src/lib/infrastructure/infrastructure.module.ts
import { Module } from '@nestjs/common';
import { SheetDataGateway } from './sheet-api/sheet-data.gateway';
import { GasQueryGateway } from './gas-web-app/gas-query.gateway';
import { GoogleSheetProvider } from '../adapters/google-sheet.provider';
// ... importaciones de servicios de auth y opciones ...

@Module({
    providers: [
        SheetDataGateway,
        GasQueryGateway,
        GoogleSheetProvider,
        // Configuración de Inyección de Dependencias por Interfaz
        {
            provide: 'ISheetWriteDriver',
            useExisting: SheetDataGateway
        },
        {
            provide: 'ISheetReadDriver',
            useExisting: GasQueryGateway
        }
    ],
    exports: [
        'ISheetWriteDriver',
        'ISheetReadDriver',
        SheetDataGateway,
        GasQueryGateway,
        GoogleSheetProvider
    ]
})
export class InfrastructureModule { }