import { Module, DynamicModule, Global, Provider } from '@nestjs/common';
import { DataSourceManager } from './core/data-source-manager';
import { GoogleHealthService } from './adapters/health/google-sheet-health.service';
import { PostgresProvider } from './adapters/postgres.provider';
import { GoogleSheetProvider } from './adapters/google-sheet.provider';
import { SheetOdmModuleAsyncOptions, SheetOdmModuleOptions } from './interfaces/sheet-odm-options.interface';
import { POSTGRES_TOKEN, SHEET_ODM_OPTIONS } from './shared/constants/constants';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { GasTelemetryInterceptor } from './core/interceptors/gas-telemetry.interceptor';
import { GasService } from './infrastructure/gas/gas.service';
import { MetadataRegistry } from './core/metadata/metadata.registry';
import { OutboxProcessor } from './core/outbox/outbox.processor';
import { OutboxModule } from './core/outbox/outbox.module';
import { OutboxService } from './core/outbox/interfaces/outbox-entry.interface';
import { HttpModule } from '@nestjs/axios';



// Este token se usará para inyectar las opciones en tus servicios

//password 3as8hq663jyoFGh5
//NEXT_PUBLIC_SUPABASE_URL=https://umbqspntiqpjkvlttpxa.supabase.co
//NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_2i5_ocsX1ED0FB36kmxhjw_t6qy5s4u
//# Connect to Postgres via the shared transaction-mode pooler (IPv4-only)
//DATABASE_URL="postgresql://postgres.umbqspntiqpjkvlttpxa:[YOUR-PASSWORD]@aws-1-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true"

//# Connect to Postgres via the shared session-mode pooler (used for migrations)
//DIRECT_URL="postgresql://postgres.umbqspntiqpjkvlttpxa:[YOUR-PASSWORD]@aws-1-us-west-2.pooler.supabase.com:5432/postgres"
@Global()
@Module({})
export class SheetOdmModule {

  static forRoot(options: SheetOdmModuleOptions): DynamicModule {
    return {
      module: SheetOdmModule,
      imports: [HttpModule, OutboxModule.register(options)],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: GasTelemetryInterceptor },
        { provide: SHEET_ODM_OPTIONS, useValue: options },  // Mantenemos compatibilidad si lo necesitas
        { provide: 'DATABASE_OPTIONS', useValue: options }, // Token unificado

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
      ],
      exports: [
        PostgresProvider, // Exportamos la clase
        POSTGRES_TOKEN,   // Exportamos el token
        DataSourceManager,
        MetadataRegistry,
        OutboxModule],
    };
  }

  static forRootAsync(options: SheetOdmModuleAsyncOptions): DynamicModule {
    if (!options.useFactory) {
      throw new Error('El método [useFactory] es requerido en forRootAsync para SheetOdmModule.');
    }
    return {
      module: SheetOdmModule,
      imports: [HttpModule, ...(options.imports || []), OutboxModule.registerAsync({
        useFactory: options.useFactory,
        inject: options.inject,
        imports: options.imports,
      })],
      providers: [
        ...this.createAsyncProviders(options),
        { provide: APP_INTERCEPTOR, useClass: GasTelemetryInterceptor },
        { provide: SHEET_ODM_OPTIONS, useValue: options },  // Mantenemos compatibilidad si lo necesitas
        { provide: 'DATABASE_OPTIONS', useValue: options }, // Token unificado
        {
          provide: SHEET_ODM_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || []
        },

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
      ],
      exports: [PostgresProvider, // Exportamos la clase
        POSTGRES_TOKEN,   // Exportamos el token
        DataSourceManager,
        MetadataRegistry,
        OutboxModule],
    };
  }

  private static createAsyncProviders(options: SheetOdmModuleAsyncOptions): Provider[] {
    // Si no hay useFactory, lanzamos error o devolvemos array vacío
    if (!options.useFactory) {
      throw new Error('Solo se soporta useFactory en esta versión.');
    }

    const providers: Provider[] = [
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

    return providers;
  }
}