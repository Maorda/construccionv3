// src/core/repository/repository-core.facade.ts
import { Inject, Injectable } from '@nestjs/common';
import { MetadataRegistry } from '../metadata/metadata.registry';
import { DataSourceManager } from '../data-source-manager';
import { UnitOfWork } from '../uow/services/unit-of-work.service';
import { SheetDocumentHydrator } from '../base/sheet-document-hydrator';
import { QueryEngine } from '../query/query.engine';
import { MutationEngine } from '../engine/mutationEngine';

import { SheetDataGateway } from '../../infrastructure/sheet-api/sheet-data.gateway';
import { SheetDataTransformer } from '../base/sheetDataTransformer';
import { PopulateEngine } from '../engine/populate.engine';
import { GasQueryGateway } from '../../infrastructure/gas-web-app/gas-query.gateway';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager'

@Injectable()
export class RepositoryCoreFacade {
    constructor(
        public readonly metadata: MetadataRegistry,
        public readonly dataSource: DataSourceManager,
        public readonly uow: UnitOfWork,
        public readonly hydrator: SheetDocumentHydrator,
        public readonly queryEngine: QueryEngine,
        public readonly mutationEngine: MutationEngine,
        public readonly readGateway: GasQueryGateway,

        public readonly gateway: SheetDataGateway,

        public readonly transformer: SheetDataTransformer,
        public readonly populateEngine: PopulateEngine,
        @Inject(CACHE_MANAGER) public readonly cacheManager: Cache
    ) { }
}