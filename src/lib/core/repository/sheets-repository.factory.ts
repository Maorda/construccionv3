import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

// Servicios base (Singletons)
import { MetadataRegistry } from '../metadata/metadata.registry';
import { DataSourceManager } from '../data-source-manager';
import { SheetDocumentHydrator } from '../base/sheet-document-hydrator';

// 🔥 Nuevos motores y pasarelas (Singletons)
import { QueryEngine } from '../query/query.engine';

import { GasService } from '../../infrastructure/gas/gas.service'; // Ajusta la ruta a tu estructura

// Dependencias dinámicas / transaccionales
import { UnitOfWork } from '../uow/services/unit-of-work.service';
import { SheetsRepository } from './sheets.repository';
import { ClassType } from '../types/common.types';
import { SheetDataGateway } from '../../infrastructure/sheet-api/sheet-data.gateway';
import { MutationEngine } from '../engine/mutationEngine';

@Injectable()
export class SheetsRepositoryFactory {
    // Constructor: Inyectamos los Singletons normales de NestJS
    // y el ModuleRef para resolver los de Scope.REQUEST
    constructor(
        private readonly moduleRef: ModuleRef,
        private readonly metadataRegistry: MetadataRegistry,
        private readonly dataSource: DataSourceManager,
        private readonly hydrator: SheetDocumentHydrator,
        // 🔥 Inyectamos las nuevas dependencias requeridas por el repositorio
        private readonly queryEngine: QueryEngine,
        private readonly mutationEngine: MutationEngine,
        private readonly gasService: GasService,
        private readonly gateway: SheetDataGateway
    ) { }

    /**
     * Fabrica dinámicamente un SheetsRepository ligado al Request actual.
     */
    async create<T extends object>(entityClass: ClassType<T>): Promise<SheetsRepository<T>> {

        // Resolvemos dependencias con scope REQUEST (como el UoW) en tiempo de ejecución.
        // Al usar resolve(), NestJS nos garantiza que si ya existe un UoW para esta 
        // petición HTTP, nos devolverá esa misma instancia.
        const uow = await this.moduleRef.resolve(UnitOfWork);

        // Retornamos el repositorio ensamblado con la nueva firma
        return new SheetsRepository<T>(
            entityClass,
            this.metadataRegistry,
            this.dataSource,
            uow,
            this.hydrator,
            // 🔥 Pasamos las nuevas dependencias al constructor del repositorio
            this.queryEngine,
            this.mutationEngine,
            this.gasService,
            this.gateway
        );
    }
}