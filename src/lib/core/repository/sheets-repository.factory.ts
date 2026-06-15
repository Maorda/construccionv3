import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

// Servicios base (Singletons)
import { MetadataRegistry } from '../metadata/metadata.registry';
import { DataSourceManager } from '../data-source-manager';
import { SheetDocumentHydrator } from '../base/sheet-document-hydrator';

// Dependencias dinámicas / transaccionales
import { UnitOfWork } from '../uow/services/unit-of-work.service';
import { SheetsRepository } from './sheets.repository';
import { ClassType } from '../types/common.types';

@Injectable()
export class SheetsRepositoryFactory {
    // Constructor limpio: Inyectamos los Singletons normales de NestJS
    // y el ModuleRef para resolver los de Scope.REQUEST
    constructor(
        private readonly moduleRef: ModuleRef,
        private readonly metadataRegistry: MetadataRegistry,
        private readonly dataSource: DataSourceManager,
        private readonly hydrator: SheetDocumentHydrator
    ) { }

    /**
     * Fabrica dinámicamente un SheetsRepository ligado al Request actual.
     */
    async create<T extends object>(entityClass: ClassType<T>): Promise<SheetsRepository<T>> {

        // Resolvemos dependencias con scope REQUEST (como el UoW) en tiempo de ejecución.
        // Al usar resolve(), NestJS nos garantiza que si ya existe un UoW para esta 
        // petición HTTP, nos devolverá esa misma instancia.
        const uow = await this.moduleRef.resolve(UnitOfWork);

        // Retornamos el repositorio ensamblado con la nueva firma ultra-limpia
        return new SheetsRepository<T>(
            entityClass,
            this.metadataRegistry,
            this.dataSource,
            uow,
            this.hydrator
        );
    }
}