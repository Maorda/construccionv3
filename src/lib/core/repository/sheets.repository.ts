import { Logger } from '@nestjs/common';
import { MetadataRegistry } from '../metadata/metadata.registry';
import { DataSourceManager } from '../data-source-manager';
import { UnitOfWork } from '../uow/services/unit-of-work.service';

import { ClassType } from '../types/common.types';
import { ROW_INDEX_SYMBOL } from '../../shared/constants/constants';
import { TypeOp } from '../outbox/interfaces/outbox-entry.interface';
import { SheetDocument } from '../wrapper/sheet-document';
import { SheetDocumentHydrator } from '../base/sheet-document-hydrator';

export class SheetsRepository<T extends object, U extends SheetDocument<T> = SheetDocument<T>> {
    // 1. Declaramos el logger sin inicializarlo inmediatamente
    private readonly logger: Logger;
    private readonly sheetName: string;
    constructor(
        private readonly entityClass: ClassType<T>,
        private readonly metadataRegistry: MetadataRegistry,
        private readonly dataSource: DataSourceManager,
        private readonly uow: UnitOfWork,
        private readonly hydrator: SheetDocumentHydrator
    ) {
        this.logger = new Logger(`Repository<${this.entityClass.name}>`);
        this.sheetName = this.metadataRegistry.getSchema(this.entityClass).sheetName;
    }

    /**
     * Busca un único registro. 
     * Implementa Identity Map: si ya está en UoW, lo devuelve desde ahí.
     */
    async findOne(column: string, value: any): Promise<U | null> {
        // 1. Intentar obtener de UoW (Identity Map)
        // Nota: Asumimos que si tienes una forma de buscar por PK en el map, lo haces aquí.

        // 2. Si no, fetch de la fuente de verdad (GAS)
        const rawData = await this.dataSource.readFindOne<T>(this.sheetName, column, value);
        if (!rawData) return null;

        // 3. Hidratar y registrar en UoW
        const doc = this.hydrator.hydrateAndShield(this.entityClass, this, rawData) as U;
        this.uow.register(doc, (doc as any)[this.getPrimaryKeyField()], this.entityClass);

        return doc;
    }

    /**
     * Guarda o actualiza un documento.
     * Si UoW es transaccional, encola. Si no, persiste directo.
     */
    async save(doc: U): Promise<U> {
        const pk = (doc as any)[this.getPrimaryKeyField()];
        const isNew = (doc as any)[ROW_INDEX_SYMBOL] === undefined;
        const operation: TypeOp = isNew ? TypeOp.INSERT : TypeOp.UPDATE;

        // El payload listo para la fila de Google Sheets
        const payload = doc.toJSON();

        if (this.uow.hasActiveTransaction()) {
            this.logger.debug(`[Repository] Encolando operación ${operation} en UoW para ${this.sheetName}`);
            this.uow.queueOperation({
                type: operation,
                entityClass: this.entityClass,
                sheetName: this.sheetName,
                doc: payload,
                pk: pk
            });
            // Registramos en el mapa de identidad para que posteriores accesos lo encuentren
            this.uow.register(doc, pk, this.entityClass);
            return doc;
        }

        // Persistencia directa (Sin UoW)
        this.logger.debug(`[Repository] Ejecución directa ${operation} en ${this.sheetName}`);
        await this.dataSource.dispatchMutation(this.entityClass, operation, payload, payload);

        return doc;
    }

    /**
     * Elimina un documento.
     */
    async delete(doc: U): Promise<boolean> {
        const pk = (doc as any)[this.getPrimaryKeyField()];

        if (this.uow.hasActiveTransaction()) {
            this.uow.queueOperation({
                type: TypeOp.DELETE,
                entityClass: this.entityClass,
                sheetName: this.sheetName,
                doc: doc.toJSON(),
                pk: pk
            });
            return true;
        }

        await this.dataSource.dispatchMutation(this.entityClass, TypeOp.DELETE, doc.toJSON(), doc.toJSON());
        return true;
    }

    // --- Helpers Internos ---
    private getPrimaryKeyField(): string {
        return this.metadataRegistry.getPrimaryKeyField(this.entityClass);
    }
}