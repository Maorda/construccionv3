import { DynamicModule, Module } from '@nestjs/common';
import { PostgresOutboxService } from './services/postgres-outbox.service';
import { OutboxService } from './interfaces/outbox-entry.interface';
import { OutboxProcessor } from './outbox.processor';
import { HttpModule } from '@nestjs/axios';
import { SheetOdmModuleOptions } from '../../interfaces/sheet-odm-options.interface';
import { SHEET_ODM_OPTIONS } from '../../shared/constants/constants';

// Definimos una interfaz para el async options
export interface OutboxAsyncOptions {
    useFactory: (...args: any[]) => any;
    inject?: any[];
    imports?: any[];
}
@Module({})
export class OutboxModule {
    static register(options: SheetOdmModuleOptions): DynamicModule {
        return {
            module: OutboxModule,
            providers: [
                OutboxProcessor,
                {
                    provide: OutboxService, // Cualquier componente que pida OutboxService recibirá Postgres
                    useClass: PostgresOutboxService,
                },
                {
                    provide: SHEET_ODM_OPTIONS,
                    useValue: options,
                },
            ],
            //imports: [InfrastructureModule],
            exports: [OutboxService, OutboxProcessor],
        };
    }
    static registerAsync(options: OutboxAsyncOptions): DynamicModule {
        return {
            module: OutboxModule,
            imports: options.imports || [],
            providers: [
                {
                    provide: SHEET_ODM_OPTIONS,
                    useFactory: options.useFactory,
                    inject: options.inject || [],
                },
                OutboxProcessor,
                {
                    provide: OutboxService,
                    useClass: PostgresOutboxService,
                },
            ],
            exports: [OutboxService, OutboxProcessor],
        };
    }
}