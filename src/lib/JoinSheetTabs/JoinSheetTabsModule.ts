import { Module } from '@nestjs/common';
import { JoinEngine } from './JoinEngine';
import { JoinSheetTabsService } from './JoinSheetTabsService';
import { MetadataRegistry } from './metadata.registry';


@Module({
    providers: [
        JoinEngine,
        JoinSheetTabsService,
        // Al proveer MetadataRegistry aquí, NestJS resolverá la instancia. 
        // Si ya está en un módulo global, lo ideal sería importarlo, pero al ser inyectable funciona perfectamente.
        MetadataRegistry
    ],
    exports: [
        JoinSheetTabsService,
        JoinEngine
    ]
})
export class JoinSheetTabsModule { }