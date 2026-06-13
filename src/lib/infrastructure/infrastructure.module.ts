// src/lib/infrastructure/infrastructure.module.ts
import { Module } from '@nestjs/common';
import { SheetDataGateway } from './sheet-api/sheet-data.gateway.js';
import { GasQueryGateway } from './gas-web-app/gas-query.gateway.js';
// ... importaciones de servicios de auth y opciones ...

@Module({
    providers: [
        SheetDataGateway,
        GasQueryGateway,
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
        'ISheetReadDriver'
    ]
})
export class InfrastructureModule { }