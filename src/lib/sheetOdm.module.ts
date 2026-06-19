import { Module, DynamicModule, Global, Provider, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { APP_INTERCEPTOR } from '@nestjs/core';

// Interfaces, Constantes y Tokens
import { SheetOdmModuleAsyncOptions, SheetOdmModuleOptions } from './interfaces/sheet-odm-options.interface';
import { POSTGRES_TOKEN, SHEET_ODM_OPTIONS } from './shared/constants/constants';
import { PIPELINE_STAGE, DATA_TRANSFORM_OPERATOR, FILTER_OPERATOR } from './stages/pipeline.constants';

// Núcleo del Sistema (Core)
import { DataSourceManager } from './core/data-source-manager';
import { MetadataRegistry } from './core/metadata/metadata.registry';
import { GasTelemetryInterceptor } from './core/interceptors/gas-telemetry.interceptor';
import { SheetDocumentHydrator } from './core/base/sheet-document-hydrator';
import { SheetDataTransformer } from './core/base/sheetDataTransformer';
import { PopulateEngine } from './core/engine/populate.engine';
import { QueryEngine } from './core/query/query.engine';
import { MutationEngine } from './core/engine/mutationEngine';

// Pipeline Stages
import { MatchStage, ProjectStage, AddFieldsStage } from './stages/filtrado_y_transformacion';
import { LimitStage, SkipStage, SortStage } from './stages/orden_y_paginacion';
import { ExpressionEngine } from './stages/expression.engine';

// Operadores
import {
  AggregateOperator, ConcatOperator, DateAddOperator, IfOperator,
  IncOperator, MathOperator, MinMaxOperator, MultiplyOperator,
  RoundOperator, TimeDiffOperator, TrimOperator, UpperOperator
} from './stages/transform.operators';
import { EqOperator, GtOperator } from './stages/filter.operators';

// Infraestructura y Repositorios
import { PostgresProvider } from './adapters/postgres.provider';
import { GoogleSheetProvider } from './adapters/google-sheet.provider';
import { GoogleHealthService } from './adapters/health/google-sheet-health.service';
import { GasService } from './infrastructure/gas/gas.service';
import { SheetDataGateway } from './infrastructure/sheet-api/sheet-data.gateway';
import { GasQueryGateway } from './infrastructure/gas-web-app/gas-query.gateway';
import { InfrastructureProvisioner } from './infrastructure/InfrastructureProvisioner';

// Submódulos Externos
import { OutboxModule } from './core/outbox/outbox.module';
import { UowModule } from './core/uow/uow.module';
import { OdmDiagnosticsService } from './core/diagnostic/odm-diagnostics.service';
import { OdmDiagnosticsController } from './core/diagnostic/odm-diagnostics.controller';
import { SheetsRepositoryFactory } from './core/repository/sheets-repository.factory';
import { SheetsRepository } from './core/repository/sheets.repository';
import { UnitOfWork } from './core/uow/services/unit-of-work.service';
import { createModel } from './core/model/model.factory';
import { RepositoryCoreFacade } from './core/repository/repository-core.facade';


// ============================================================================
// AGRUPACIONES DE PROVIDERS (Para mantener el decorador Module limpio)
// ============================================================================

const CORE_SHARED_SERVICES: Provider[] = [
  RepositoryCoreFacade,
  DataSourceManager,
  MetadataRegistry,
  OdmDiagnosticsService,
  SheetsRepositoryFactory,
  ExpressionEngine,
  QueryEngine,
  MutationEngine,
  SheetDocumentHydrator,
  GasService,
  SheetDataGateway,
  InfrastructureProvisioner,
];

const INTERNAL_SERVICES: Provider[] = [
  GoogleSheetProvider,
  GasQueryGateway,
  GoogleHealthService,
  SheetDataTransformer,
  PopulateEngine,
  { provide: APP_INTERCEPTOR, useClass: GasTelemetryInterceptor },
];

const TRANSFORM_OPERATORS = [
  ConcatOperator, IfOperator, MultiplyOperator, IncOperator,
  MinMaxOperator, RoundOperator, MathOperator, UpperOperator,
  TrimOperator, DateAddOperator, TimeDiffOperator, AggregateOperator
];

const FILTER_OPERATORS = [EqOperator, GtOperator];

const PIPELINE_STAGES = [
  MatchStage, SortStage, LimitStage, SkipStage, ProjectStage, AddFieldsStage
];

// ============================================================================
// DECLARACIÓN DEL MÓDULO
// ============================================================================

@Global()
@Module({})
export class SheetOdmModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('SheetOdm');
  private static hasBootstrapped = false;

  constructor(private readonly provisioner: InfrastructureProvisioner) { }

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || SheetOdmModule.hasBootstrapped) {
      return;
    }

    SheetOdmModule.hasBootstrapped = true;
    this.logger.log('--- 🚀 [SheetODM] Iniciando sincronización de infraestructura ---');

    try {
      await this.provisioner.syncSchema();
      this.logger.log('✅ [SheetODM] Infraestructura lista.');
    } catch (err: any) {
      this.logger.error(`❌ [SheetODM] Error de inicialización: ${err.message}`);
    }
  }

  // ========================================================================
  // CONFIGURACIÓN ASÍNCRONA (Root)
  // ========================================================================

  static forRootAsync(options: SheetOdmModuleAsyncOptions): DynamicModule {
    if (!options.useFactory) {
      throw new Error('El método [useFactory] es requerido en forRootAsync para SheetOdmModule.');
    }

    return {
      global: true, // 🚀 Asegura que los providers de forRootAsync sean singletons globales reales
      module: SheetOdmModule,
      imports: [
        HttpModule,
        UowModule,
        ...(options.imports || []),
        OutboxModule.registerAsync({
          useFactory: options.useFactory,
          inject: options.inject,
          imports: options.imports,
        }),
      ],
      controllers: [OdmDiagnosticsController],
      providers: [
        // 1. Opciones Async
        { provide: 'DATABASE_OPTIONS', useFactory: options.useFactory, inject: options.inject || [] },
        { provide: SHEET_ODM_OPTIONS, useFactory: options.useFactory, inject: options.inject || [] },

        // 2. Adaptador Postgres
        {
          provide: PostgresProvider,
          useFactory: (opts: SheetOdmModuleOptions) => new PostgresProvider(opts),
          inject: [SHEET_ODM_OPTIONS],
        },
        { provide: POSTGRES_TOKEN, useExisting: PostgresProvider },

        // 3. Servicios Core
        ...INTERNAL_SERVICES,
        ...CORE_SHARED_SERVICES,

        // 4. Operadores de Expresión (Registrados individualmente + Agrupados por Token)
        ...TRANSFORM_OPERATORS,
        ...FILTER_OPERATORS,
        {
          provide: DATA_TRANSFORM_OPERATOR,
          useFactory: (...operators: any[]) => operators,
          inject: TRANSFORM_OPERATORS,
        },
        {
          provide: FILTER_OPERATOR,
          useFactory: (...operators: any[]) => operators,
          inject: FILTER_OPERATORS,
        },

        // 5. Stages del Pipeline
        ...PIPELINE_STAGES,
        {
          provide: PIPELINE_STAGE,
          useFactory: (...stages: any[]) => stages,
          inject: PIPELINE_STAGES,
        },
      ],
      exports: [
        UowModule,
        OutboxModule,
        PostgresProvider,
        POSTGRES_TOKEN,
        ...CORE_SHARED_SERVICES,
      ],
    };
  }

  // ========================================================================
  // REGISTRO DE ENTIDADES (Feature)
  // ========================================================================

  static forFeature(entities: Function[]): DynamicModule {
    const providers: Provider[] = entities.flatMap((entity) => {
      MetadataRegistry.register(entity as any);

      const repositoryToken = `SheetsRepository_${entity.name}`;

      // 🚀 2. Mira lo limpio que queda ahora el Factory del Repositorio
      const repositoryProvider: Provider = {
        provide: repositoryToken,
        useFactory: (coreFacade: RepositoryCoreFacade) =>
          new SheetsRepository(entity as any, coreFacade),
        inject: [RepositoryCoreFacade], // Solo 1 inyección
      };

      const modelProvider: Provider = {
        provide: `${entity.name}Model`,
        useFactory: (repo: SheetsRepository<any>) => createModel(entity as any, repo),
        inject: [repositoryToken],
      };

      return [repositoryProvider, modelProvider];
    });

    return {
      module: SheetOdmModule,
      providers: providers,
      exports: providers,
    };
  }
}