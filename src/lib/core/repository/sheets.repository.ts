import { Logger } from '@nestjs/common';
import { MetadataRegistry } from '../metadata/metadata.registry';
import { DataSourceManager } from '../data-source-manager';
import { UnitOfWork } from '../uow/services/unit-of-work.service';

import { ClassType } from '../types/common.types';
import { ROW_INDEX_SYMBOL } from '../../shared/constants/constants';
import { TypeOp } from '../outbox/interfaces/outbox-entry.interface';
import { SheetDocument } from '../wrapper/sheet-document';
import { SheetDocumentHydrator } from '../base/sheet-document-hydrator';
import { FilterQuery, FindOneAndUpdateOptions, QueryOptions, UpdateQuery } from '../model/model.factory';
import { QueryEngine } from '../query/query.engine';
import { MutationEngine } from '../engine/mutationEngine';
import { GasService } from '../../infrastructure/gas/gas.service';
import { SheetDataGateway } from '../../infrastructure/sheet-api/sheet-data.gateway';
import { SheetDataTransformer } from '../base/sheetDataTransformer';

export class SheetsRepository<T extends object, U extends SheetDocument<T> = SheetDocument<T>> {
    private readonly logger: Logger;
    private readonly sheetName: string;

    constructor(
        private readonly entityClass: ClassType<T>,
        private readonly metadataRegistry: MetadataRegistry,
        private readonly dataSource: DataSourceManager,
        private readonly uow: UnitOfWork, // Mantenemos el nombre 'uow'
        private readonly hydrator: SheetDocumentHydrator,
        // 🌟 Inyecciones añadidas para que los métodos funcionen
        private readonly queryEngine: QueryEngine,
        private readonly mutationEngine: MutationEngine,
        private readonly gasService: GasService,
        private readonly gateway: SheetDataGateway,
        private readonly transformer: SheetDataTransformer,
    ) {
        this.logger = new Logger(`Repository<${this.entityClass.name}>`);
        this.sheetName = this.metadataRegistry.getSchema(this.entityClass).sheetName;
    }

    /**
     * 🔍 BÚSQUEDA ÚNICA
     */
    async findOne(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<U | null> {
        if (this.canUseGasFastRoute(filter, options)) {
            const propertyName = Object.keys(filter!)[0];
            const searchValue = String(filter![propertyName as keyof FilterQuery<T>]);

            // 🚀 PARCHE 1: Traducir nombre de propiedad a nombre de Cabecera (Sheet Header)
            const schema = this.metadataRegistry.getSchema(this.entityClass);
            const colConfig = schema.columns[propertyName];
            const columnName = (colConfig?.name || propertyName).toUpperCase();

            try {
                const rawData = await this.gasService.findOne<any>(this.sheetName, columnName, searchValue);

                if (rawData) {
                    this.logger.debug(`[Cache Hit - GAS] Registro encontrado en ${this.sheetName}`);
                    return this.hydrateAndCacheRawResult<U>(rawData, options);
                }
                return null;
            } catch (error: any) {
                this.logger.warn(`[Fallback] GAS falló en findOne, usando escaneo completo. Error: ${error.message}`);
            }
        }

        const results = await this.find(filter, { ...options, limit: 1 });
        return results.length > 0 ? (results[0] as U) : null;
    }

    /**
     * 🔍 BÚSQUEDA MÚLTIPLE
     */
    async find(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<U[]> {
        const safeFilter = filter || ({} as FilterQuery<T>);

        if (this.canUseGasFastRoute(safeFilter, options)) {
            const propertyName = Object.keys(safeFilter)[0];
            const searchValue = String(safeFilter[propertyName as keyof FilterQuery<T>]);

            // 🚀 PARCHE 1: Traducción a cabecera real
            const schema = this.metadataRegistry.getSchema(this.entityClass);
            const colConfig = schema.columns[propertyName];
            const columnName = (colConfig?.name || propertyName).toUpperCase();

            try {
                const rawArray = await this.gasService.findMany<any>(this.sheetName, columnName, searchValue);

                if (rawArray && rawArray.length > 0) {
                    const processedItems = await this.queryEngine.execute(rawArray, safeFilter, options);
                    return processedItems.map(raw => this.hydrateAndCacheRawResult<U>(raw, options));
                }
                return [];
            } catch (error: any) {
                this.logger.warn(`[Fallback] Búsqueda rápida GAS falló (${error.message}). Pasando a ruta local...`);
            }
        }

        const rawItems = await this.fetchRawData(options?.includeInactive);
        const processedItems = await this.queryEngine.execute(rawItems, safeFilter, options);

        return processedItems.map(raw => this.hydrateAndCacheRawResult<U>(raw, options));
    }

    /**
     * 🔄 BUSCAR Y ACTUALIZAR
     */
    async findOneAndUpdate(
        filter: FilterQuery<T>,
        update: UpdateQuery<T>,
        options: FindOneAndUpdateOptions<T, U> = {}
    ): Promise<U | null> {
        const found = await this.findOne(filter, {
            includeInactive: options.includeInactive,
            customConstructor: options.customConstructor as any
        });

        if (!found) {
            if (options.upsert) {
                const createData = { ...filter, ...(update.$set || update) };
                const newDoc = this.create(createData) as U;
                return await newDoc.save();
            }
            return null;
        }

        const mutatedData = this.mutationEngine.mutate(update, found.toObject());
        Object.assign(found, mutatedData);

        const saved = await found.save();
        return options.new !== false ? saved : found;
    }

    /**
     * 📊 AGREGACIÓN
     */
    async aggregate<R = any>(pipeline: any[]): Promise<R[]> {
        try {
            const rawItems = await this.fetchRawData(false);
            return await this.queryEngine.aggregate(rawItems, pipeline) as R[];
        } catch (error: any) {
            this.logger.error(`❌ Error en aggregate() en "${this.sheetName}": ${error.message}`);
            throw error;
        }
    }

    /**
     * 📝 GUARDAR (UoW o Directo)
     */
    async save(doc: SheetDocument<T>): Promise<SheetDocument<T>> {
        const pkField = this.getPrimaryKeyField();

        // Ahora esto SÍ funcionará porque definimos el método en la clase base
        const pk = doc.getPrimaryKeyValue(pkField as keyof T);

        const rowIndex = doc.rowNumber;
        const isNew = rowIndex === undefined;
        const operation: TypeOp = isNew ? TypeOp.INSERT : TypeOp.UPDATE;

        const payload = {
            ...doc.toJSON(),
            ...(rowIndex !== undefined ? { _row: rowIndex } : {})
        } as T & { _row?: number };

        // --- UoW y Dispatcher ---
        if (this.uow.hasActiveTransaction()) {
            this.uow.queueOperation({
                type: operation,
                entityClass: this.entityClass,
                sheetName: this.sheetName,
                doc: payload,
                pk: pk // Aquí tenemos el pk tipado
            });
            this.uow.register(doc, pk, this.entityClass);
            return doc;
        }

        await this.dataSource.dispatchMutation(this.entityClass, operation, payload, payload);
        return doc;
    }

    /**
     * 🗑️ ELIMINAR
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

    /**
     * 🆕 CREAR INSTANCIA
     */
    create(data: Partial<T>): U {
        return this.hydrator.hydrateAndShield(this.entityClass, this, data, { new: true }) as U;
    }

    // ====================================================================
    // HELPERS INTERNOS
    // ====================================================================

    protected hydrateAndCacheRawResult<Ret extends U = U>(
        rawObject: any,
        options?: QueryOptions<T>
    ): Ret {
        if (rawObject._row !== undefined && rawObject._row !== null) {
            rawObject[ROW_INDEX_SYMBOL] = rawObject._row;
            delete rawObject._row;
        }

        const pkField = this.getPrimaryKeyField();
        const pkValue = rawObject[pkField];

        if (options?.lean) {
            return this.instantiateDocument<Ret>(rawObject, options);
        }

        // 🌟 Corregido: this.uow en lugar de this.unitOfWork
        if (pkValue) {
            const existingDoc = this.uow.get(pkValue, this.entityClass);
            if (existingDoc) {
                return existingDoc as Ret;
            }
        }

        const doc = this.instantiateDocument<Ret>(rawObject, options);

        if (pkValue) {
            this.uow.register(doc, pkValue, this.entityClass);
        }

        return doc;
    }

    private instantiateDocument<Ret extends U>(
        rawObject: any,
        options?: QueryOptions<T>
    ): Ret {
        let doc: SheetDocument<T>;

        try {
            if (options?.customConstructor) {
                doc = new options.customConstructor(rawObject, this, false);
                doc.markAsSaved(rawObject[ROW_INDEX_SYMBOL]);

                const version = rawObject.version !== undefined ? parseInt(rawObject.version, 10) : 0;
                doc.setVersion(version);
            } else {
                doc = this.hydrator.hydrateAndShield(this.entityClass, this, rawObject);
            }

            return doc as Ret;
        } catch (error: any) {
            this.logger.error(`[Hydrator] Error crítico al instanciar registro en '${this.sheetName}'. Detalles: ${error.message}`);
            throw new Error(`Fallo estructural al hidratar la entidad ${this.entityClass.name}.`);
        }
    }

    protected async fetchRawData(includeInactive = false): Promise<any[]> {
        const bounds = await this.gateway.getBoundaries(this.sheetName);
        const colLetter = String.fromCharCode(64 + bounds.lastColumn);
        const perfectRange = `${this.sheetName}!A1:${colLetter}${bounds.lastRow}`;
        const allRows = await this.gateway.getRange(perfectRange);
        if (!allRows || allRows.length === 0) return [];

        const headers = allRows[0].map((h: any) => String(h).trim().toUpperCase());
        const dataRows = allRows.slice(1);
        const schema = this.metadataRegistry.getSchema(this.entityClass);

        let items = dataRows.map((row, index) => {
            const plainObject: any = {};
            plainObject[ROW_INDEX_SYMBOL] = index + 2;

            for (const prop of Object.keys(schema.columns)) {
                const colConfig = schema.columns[prop];
                const headerName = (colConfig.name || prop).toUpperCase();
                const colIndex = headers.indexOf(headerName);

                plainObject[prop] = colIndex !== -1 ? row[colIndex] : (colConfig.default ?? null);
            }
            return plainObject;
        });

        const deleteControlProp = schema.deleteControl;
        if (deleteControlProp && !includeInactive) {
            items = items.filter(item => !item[deleteControlProp]);
        }
        return items;
    }

    private canUseGasFastRoute(filter?: FilterQuery<T>, options?: QueryOptions<T>): boolean {
        if (!filter || Object.keys(filter).length !== 1) return false;
        if (options?.sort) return false;

        const value = Object.values(filter)[0];
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    }

    private getPrimaryKeyField(): string {
        return this.metadataRegistry.getPrimaryKeyField(this.entityClass);
    }
    async commitBulk(documents: any[]): Promise<void> {
        if (!documents || documents.length === 0) return;

        // 1. Clasificación de operaciones
        const inserts = documents.filter(doc => !doc[ROW_INDEX_SYMBOL]);
        const updates = documents.filter(doc => doc[ROW_INDEX_SYMBOL] && !doc.deleted);
        const deletes = documents.filter(doc => doc[ROW_INDEX_SYMBOL] && doc.deleted);

        try {
            // 2. Ejecución Secuencial (Respetando el orden lógico de escritura en Sheets)

            // A. Borrados (Hard o Soft)
            if (deletes.length > 0) {
                await this.processDeletes(deletes);
            }

            // B. Actualizaciones
            if (updates.length > 0) {
                await this.processUpdates(updates);
            }

            // C. Inserciones
            if (inserts.length > 0) {
                await this.processInserts(inserts);
            }

            this.logger.debug(`[commitBulk] Lote procesado exitosamente: ${documents.length} registros.`);
        } catch (error: any) {
            this.logger.error(`[commitBulk] Fallo en la ejecución del lote: ${error.message}`);
            throw error; // Propagamos para que el OutboxProcessor maneje el reintento
        }
    }

    private async processDeletes(docs: any[]): Promise<void> {
        const deleteControlProp = this.metadataRegistry.getDeleteControlProperty(this.entityClass);
        const hardDeleteRanges: string[] = [];
        const softDeleteUpdates: { range: string; values: any[][] }[] = [];

        for (const doc of docs) {
            const rowIndex = doc[ROW_INDEX_SYMBOL];
            if (deleteControlProp) {
                // Soft delete: Actualizar celda a true
                doc[deleteControlProp] = true;
                softDeleteUpdates.push({
                    range: `${this.sheetName}!A${rowIndex}`,
                    values: [this.prepareDataWithVersion(doc, doc.version + 1)]
                });
            } else {
                // Hard delete: Limpiar fila
                hardDeleteRanges.push(`${this.sheetName}!${rowIndex}:${rowIndex}`);
            }
        }

        if (hardDeleteRanges.length > 0) await this.gateway.batchClearValues(hardDeleteRanges);
        if (softDeleteUpdates.length > 0) await this.gateway.batchUpdateValues(softDeleteUpdates);
    }

    private async processUpdates(docs: any[]): Promise<void> {
        const payloads = docs.map(doc => ({
            range: `${this.sheetName}!A${doc[ROW_INDEX_SYMBOL]}`,
            values: [this.prepareDataWithVersion(doc, doc.version + 1)]
        }));
        await this.gateway.batchUpdateValues(payloads);
    }

    private async processInserts(docs: any[]): Promise<void> {
        const rows = docs.map(doc => this.prepareDataWithVersion(doc, 1));
        await this.gateway.appendRows(this.sheetName, rows);
    }
    private prepareDataWithVersion(dataObject: any, newVersion: number): any[] {
        const versionField = this.metadataRegistry.getVersionField(this.entityClass);
        const schema = this.metadataRegistry.getSchema(this.entityClass);

        return schema.columnList.map(columnName => {
            if (columnName === versionField) return newVersion;

            const rawValue = dataObject[columnName];
            // Inferimos el tipo desde el decorador @Column de tu metadata
            const colType = schema.columns[columnName]?.type || 'string';

            // 🛡️ SERIALIZACIÓN SEGURA: Usamos tu transformer real
            return this.transformer.prepareValueForSheet(rawValue, colType);
        });
    }
}