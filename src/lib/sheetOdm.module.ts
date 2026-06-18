import { Module, DynamicModule, Global, Provider, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { SheetDataTransformer } from './core/base/sheetDataTransformer'; // 💡 Ajusta la ruta real de tu archivo
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
import { ExpressionEngine } from './stages/expression.engine';

// Operadores de Expresiones (Filtros y Transformaciones)
// 💡 NOTA: Reemplaza estos nombres por tus clases reales de operadores


// Pipeline Stages
import { MatchStage, ProjectStage, AddFieldsStage } from './stages/filtrado_y_transformacion';
import { LimitStage, SkipStage, SortStage } from './stages/orden_y_paginacion';

// Infraestructura y Repositorios
import { PostgresProvider } from './adapters/postgres.provider';
import { GoogleSheetProvider } from './adapters/google-sheet.provider';
import { GoogleHealthService } from './adapters/health/google-sheet-health.service';
import { GasService } from './infrastructure/gas/gas.service';
import { SheetDataGateway } from './infrastructure/sheet-api/sheet-data.gateway';
import { GasQueryGateway } from './infrastructure/gas-web-app/gas-query.gateway';
import { QueryEngine } from './core/query/query.engine';
import { MutationEngine } from './core/engine/mutationEngine';

// Submódulos Externos
import { OutboxModule } from './core/outbox/outbox.module';
import { UowModule } from './core/uow/uow.module';
import { OdmDiagnosticsService } from './core/diagnostic/odm-diagnostics.service';
import { OdmDiagnosticsController } from './core/diagnostic/odm-diagnostics.controller';
import { SheetsRepositoryFactory } from './core/repository/sheets-repository.factory';
import { SheetsRepository } from './core/repository/sheets.repository';
import { UnitOfWork } from './core/uow/services/unit-of-work.service';
import { createModel } from './core/model/model.factory';
import { AggregateOperator, ConcatOperator, DateAddOperator, IfOperator, IncOperator, MathOperator, MinMaxOperator, MultiplyOperator, RoundOperator, TimeDiffOperator, TrimOperator, UpperOperator } from './stages/transform.operators';
import { EqOperator, GtOperator } from './stages/filter.operators';
import { InfrastructureProvisioner } from './infrastructure/InfrastructureProvisioner';


const CORE_SHARED_SERVICES: Provider[] = [
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

// Servicios de uso estrictamente interno (No necesitan ser exportados)
const INTERNAL_SERVICES: Provider[] = [
  GoogleSheetProvider,
  GasQueryGateway,
  GoogleHealthService,
  SheetDataTransformer,
  { provide: APP_INTERCEPTOR, useClass: GasTelemetryInterceptor },
];
@Global()
@Module({})
export class SheetOdmModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('SheetOdm');

  // Candado para evitar que el bootstrap se ejecute múltiples veces por los módulos dinámicos
  private static hasBootstrapped = false;

  constructor(private readonly provisioner: InfrastructureProvisioner) { }

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || SheetOdmModule.hasBootstrapped) {
      return;
    }

    SheetOdmModule.hasBootstrapped = true; // Bloqueamos ejecuciones futuras
    this.logger.log('--- 🚀 [SheetODM] Iniciando sincronización de infraestructura ---');

    this.provisioner.syncSchema()
      .then(() => this.logger.log('✅ [SheetODM] Infraestructura lista.'))
      .catch(err => this.logger.error('❌ [SheetODM] Error de inicialización:', err.message));
  }
  /**
   * Registra los operadores de transformación y filtrado requeridos por el ExpressionEngine
   */
  private static createExpressionOperatorsProviders(): Provider[] {
    return [
      // =========================================================================
      // 1. REGISTRO INDIVIDUAL DE OPERADORES (Para el contenedor de NestJS)
      // =========================================================================

      // Operadores de Filtro Existentes
      EqOperator,
      GtOperator,

      // Operadores de Transformación (Existentes + Nuevos)
      ConcatOperator,

      IfOperator,
      MultiplyOperator,
      IncOperator,
      MinMaxOperator,
      RoundOperator,
      MathOperator,
      UpperOperator,
      TrimOperator,
      DateAddOperator,
      TimeDiffOperator,
      AggregateOperator,

      // =========================================================================
      // 2. AGRUPADOR PARA DATA_TRANSFORM_OPERATOR (Inyección por token)
      // =========================================================================
      {
        provide: DATA_TRANSFORM_OPERATOR,
        useFactory: (
          concat: ConcatOperator,

          ifOp: IfOperator,
          multiply: MultiplyOperator,
          inc: IncOperator,
          minMax: MinMaxOperator,
          round: RoundOperator,
          mathOp: MathOperator,
          upper: UpperOperator,
          trim: TrimOperator,
          dateAdd: DateAddOperator,
          timeDiff: TimeDiffOperator,
          aggregate: AggregateOperator
        ) => [
            concat,

            ifOp,
            multiply,
            inc,
            minMax,
            round,
            mathOp,
            upper,
            trim,
            dateAdd,
            timeDiff,
            aggregate
          ],
        inject: [
          ConcatOperator,

          IfOperator,
          MultiplyOperator,
          IncOperator,
          MinMaxOperator,
          RoundOperator,
          MathOperator,
          UpperOperator,
          TrimOperator,
          DateAddOperator,
          TimeDiffOperator,
          AggregateOperator
        ],
      },

      // =========================================================================
      // 3. AGRUPADOR PARA FILTER_OPERATOR (Inyección por token)
      // =========================================================================
      {
        provide: FILTER_OPERATOR,
        useFactory: (eq: EqOperator, gt: GtOperator) => [eq, gt],
        inject: [EqOperator, GtOperator],
      },
    ];
  }

  /**
   * Registra los Stages del Pipeline de consultas
   */
  private static createStageProviders(): Provider[] {
    return [
      MatchStage,
      SortStage,
      LimitStage,
      SkipStage,
      ProjectStage,
      AddFieldsStage,
      {
        provide: PIPELINE_STAGE,
        useFactory: (
          match: MatchStage,
          sort: SortStage,
          limit: LimitStage,
          skip: SkipStage,
          project: ProjectStage,
          addFields: AddFieldsStage,
        ) => [match, sort, limit, skip, project, addFields],
        inject: [MatchStage, SortStage, LimitStage, SkipStage, ProjectStage, AddFieldsStage],
      },
    ];
  }

  static forRootAsync(options: SheetOdmModuleAsyncOptions): DynamicModule {
    if (!options.useFactory) {
      throw new Error('El método [useFactory] es requerido en forRootAsync para SheetOdmModule.');
    }

    return {
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
        ...this.createAsyncProviders(options),

        // 2. Postgres
        {
          provide: PostgresProvider,
          useFactory: (opts: SheetOdmModuleOptions) => new PostgresProvider(opts),
          inject: [SHEET_ODM_OPTIONS],
        },
        { provide: POSTGRES_TOKEN, useExisting: PostgresProvider },

        // 3. Constantes Limpias
        ...INTERNAL_SERVICES,
        ...CORE_SHARED_SERVICES,

        // 4. Expresiones y Stages
        ...this.createExpressionOperatorsProviders(),
        ...this.createStageProviders(),
      ],
      exports: [
        // Exportamos Módulos
        UowModule,
        OutboxModule,

        // Exportamos Postgres Tokens
        PostgresProvider,
        POSTGRES_TOKEN,

        // Exportamos los servicios compartidos dinámicamente
        ...CORE_SHARED_SERVICES,
      ],
    };
  }

  static forFeature(entities: Function[]): DynamicModule {
    entities.forEach((entity) => {
      MetadataRegistry.register(entity as any);
    });

    const providers: Provider[] = entities.flatMap((entity) => {
      const repositoryToken = `SheetsRepository_${entity.name}`;

      const repositoryProvider: Provider = {
        provide: repositoryToken,
        useFactory: (
          metadata: MetadataRegistry,
          dataSource: DataSourceManager,
          uow: UnitOfWork,
          hydrator: SheetDocumentHydrator,
          queryEngine: QueryEngine,
          mutationEngine: MutationEngine,
          gasService: GasService,
          gateway: SheetDataGateway
        ) => new SheetsRepository(entity as any, metadata, dataSource, uow, hydrator, queryEngine, mutationEngine, gasService, gateway),
        inject: [
          MetadataRegistry,
          DataSourceManager,
          UnitOfWork,
          SheetDocumentHydrator,
          QueryEngine,
          MutationEngine,
          GasService,
          SheetDataGateway
        ],
      };

      const modelProvider: Provider = {
        provide: `${entity.name}Model`,
        useFactory: (repo) => createModel(entity as any, repo),
        inject: [repositoryToken],
      };

      return [repositoryProvider, modelProvider];
    });

    return {
      module: SheetOdmModule,
      providers: providers,
      exports: providers, // Los repositorios creados se auto-exportan
    };
  }

  private static createAsyncProviders(options: SheetOdmModuleAsyncOptions): Provider[] {
    return [
      { provide: 'DATABASE_OPTIONS', useFactory: options.useFactory!, inject: options.inject || [] },
      { provide: SHEET_ODM_OPTIONS, useFactory: options.useFactory!, inject: options.inject || [] }
    ];
  }
}