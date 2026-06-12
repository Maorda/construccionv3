import { Module, DynamicModule, Global, Provider } from '@nestjs/common';
import { SheetOdmOptions } from './sheet-odm.interface';
import { DataSourceManager } from './core/data-source-manager';
import { GoogleHealthService } from './adapters/health/google-sheet-health.service';
import { PostgresProvider } from './adapters/postgres.provider';
import { GoogleSheetProvider } from './adapters/google-sheet.provider';
import { GoogleDriveConfig, SheetOdmModuleAsyncOptions, SheetOdmModuleOptions } from './interfaces/sheet-odm-options.interface';

export const SHEET_ODM_OPTIONS = Symbol('SHEET_ODM_OPTIONS');
// Este token se usará para inyectar las opciones en tus servicios

//password 3as8hq663jyoFGh5
//NEXT_PUBLIC_SUPABASE_URL=https://umbqspntiqpjkvlttpxa.supabase.co
//NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_2i5_ocsX1ED0FB36kmxhjw_t6qy5s4u
//# Connect to Postgres via the shared transaction-mode pooler (IPv4-only)
//DATABASE_URL="postgresql://postgres.umbqspntiqpjkvlttpxa:[YOUR-PASSWORD]@aws-1-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true"

//# Connect to Postgres via the shared session-mode pooler (used for migrations)
//DIRECT_URL="postgresql://postgres.umbqspntiqpjkvlttpxa:[YOUR-PASSWORD]@aws-1-us-west-2.pooler.supabase.com:5432/postgres"

@Global() // Opcional: si quieres que sea accesible en todos lados
@Module({

  exports: [DataSourceManager],
})
export class SheetOdmModule {
  static forRoot(options: SheetOdmModuleOptions): DynamicModule {
    return {
      module: SheetOdmModule,
      providers: [
        { provide: SHEET_ODM_OPTIONS, useValue: options },
        GoogleHealthService,
        GoogleSheetProvider,
        PostgresProvider,
        DataSourceManager,
      ],
      exports: [DataSourceManager],
    };
  }
  /**
   * Configuración asíncrona (Recomendada para producción)
   */
  static forRootAsync(options: SheetOdmModuleAsyncOptions): DynamicModule {
    return {
      module: SheetOdmModule,
      imports: options.imports || [],
      providers: [
        ...this.createAsyncProviders(options),
        GoogleHealthService,
        GoogleSheetProvider,
        PostgresProvider,
        DataSourceManager,
      ],
      exports: [DataSourceManager],
    };
  }

  private static createAsyncProviders(options: SheetOdmModuleAsyncOptions): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: SHEET_ODM_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
      ];
    }
    // Si usas useClass o useExisting, se añadiría lógica aquí.
    throw new Error('Solo se soporta useFactory en esta versión.');
  }

}