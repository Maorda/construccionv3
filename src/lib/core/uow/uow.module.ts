// src/lib/core/uow/uow.module.ts
import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { UnitOfWork } from './services/unit-of-work.service';

@Module({
    // Importamos el OutboxModule porque UoW necesita usar el PostgresOutboxService
    imports: [OutboxModule],
    providers: [UnitOfWork],
    // Exportamos UnitOfWork para que los Repositorios y Servicios de la app puedan inyectarlo
    exports: [UnitOfWork],
})
export class UowModule { }