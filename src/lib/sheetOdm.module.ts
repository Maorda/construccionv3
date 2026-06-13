import { Module, DynamicModule, Global, Provider } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { APP_INTERCEPTOR } from '@nestjs/core';

// Interfaces & Constantes
import { SheetOdmModuleAsyncOptions, SheetOdmModuleOptions } from './interfaces/sheet-odm-options.interface';
import { POSTGRES_TOKEN, SHEET_ODM_OPTIONS } from './shared/constants/constants';

// Núcleo (Core)
import { DataSourceManager } from './core/data-source-manager';
import { MetadataRegistry } from './core/metadata/metadata.registry';
import { GasTelemetryInterceptor } from './core/interceptors/gas-telemetry.interceptor';

// Adaptadores e Infraestructura
import { PostgresProvider } from './adapters/postgres.provider';
import { GoogleSheetProvider } from './adapters/google-sheet.provider';
import { GoogleHealthService } from './adapters/health/google-sheet-health.service';
import { GasService } from './infrastructure/gas/gas.service';

// Submódulos de Arquitectura
import { OutboxModule } from './core/outbox/outbox.module';
import { UowModule } from './core/uow/uow.module';

// Diagnósticos (Observabilidad)
import { OdmDiagnosticsService } from './core/diagnostic/odm-diagnostics.service';
import { OdmDiagnosticsController } from './core/diagnostic/odm-diagnostics.controller';

@Global()
@Module({})
export class SheetOdmModule {

  /**
   * Configuración Síncrona
   */
  static forRoot(options: SheetOdmModuleOptions): DynamicModule {
    return {
      module: SheetOdmModule,
      imports: [
        HttpModule,
        OutboxModule.register(options)
      ],
      controllers: [
        OdmDiagnosticsController // 🔥 Registrado aquí para el modo síncrono
      ],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: GasTelemetryInterceptor },
        { provide: SHEET_ODM_OPTIONS, useValue: options },
        { provide: 'DATABASE_OPTIONS', useValue: options },

        {
          provide: PostgresProvider,
          useFactory: (opts: SheetOdmModuleOptions) => new PostgresProvider(opts),
          inject: [SHEET_ODM_OPTIONS],
        },
        {
          provide: POSTGRES_TOKEN,
          useExisting: PostgresProvider,
        },

        GasService,
        GoogleSheetProvider,
        DataSourceManager,
        GoogleHealthService,
        MetadataRegistry,
        OdmDiagnosticsService, // 🔥 Registrado aquí como proveedor de datos
      ],
      exports: [
        PostgresProvider,
        POSTGRES_TOKEN,
        DataSourceManager,
        MetadataRegistry,
        OutboxModule,
        OdmDiagnosticsService // Lo exportamos por si quieren inyectar el servicio directamente
      ],
    };
  }

  /**
   * Configuración Asíncrona (Recomendada para producción con variables de entorno)
   */
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
        })
      ],
      controllers: [
        OdmDiagnosticsController // 🔥 Registrado aquí para el modo asíncrono
      ],
      providers: [
        ...this.createAsyncProviders(options), // Genera de manera limpia las opciones asíncronas
        { provide: APP_INTERCEPTOR, useClass: GasTelemetryInterceptor },

        {
          provide: PostgresProvider,
          useFactory: (opts: SheetOdmModuleOptions) => new PostgresProvider(opts),
          inject: [SHEET_ODM_OPTIONS],
        },
        {
          provide: POSTGRES_TOKEN,
          useExisting: PostgresProvider,
        },

        GasService,
        GoogleSheetProvider,
        DataSourceManager,
        GoogleHealthService,
        MetadataRegistry,
        OdmDiagnosticsService, // 🔥 Registrado aquí como proveedor de datos
      ],
      exports: [
        UowModule,
        PostgresProvider,
        POSTGRES_TOKEN,
        DataSourceManager,
        MetadataRegistry,
        OutboxModule,
        OdmDiagnosticsService
      ],
    };
  }

  /**
   * Helper Factory para resolver las opciones asíncronas dinámicamente
   */
  private static createAsyncProviders(options: SheetOdmModuleAsyncOptions): Provider[] {
    if (!options.useFactory) {
      throw new Error('Solo se soporta useFactory en esta versión.');
    }

    return [
      {
        provide: 'DATABASE_OPTIONS',
        useFactory: options.useFactory,
        inject: options.inject || [],
      },
      {
        provide: SHEET_ODM_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      }
    ];
  }
}