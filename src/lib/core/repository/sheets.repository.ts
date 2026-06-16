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
        private readonly gateway: SheetDataGateway
    ) {
        this.logger = new Logger(`Repository<${this.entityClass.name}>`);
        this.sheetName = this.metadataRegistry.getSchema(this.entityClass).sheetName;
    }

    /**
     * 🔍 BÚSQUEDA ÚNICA
     */
    async findOne(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<U | null> {
        // 1. Usamos el mismo helper de ruta rápida que 'find'
        if (this.canUseGasFastRoute(filter, options)) {
            const columnName = Object.keys(filter!)[0];
            const searchValue = String(filter![columnName]);

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

        // 2. Ruta Lenta (Fallback)
        const results = await this.find(filter, { ...options, limit: 1 });
        return results.length > 0 ? (results[0] as U) : null;
    }

    /**
     * 🔍 BÚSQUEDA MÚLTIPLE
     */
    async find(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<U[]> {
        // 1. Sanitizamos el filtro: si es undefined, lo convertimos en un objeto vacío.
        // Esto elimina las quejas de TypeScript y previene errores en el QueryEngine.
        const safeFilter = filter || ({} as FilterQuery<T>);

        // 🚀 CARRIL RÁPIDO
        if (this.canUseGasFastRoute(safeFilter, options)) {
            // Ya no necesitas usar "!" porque safeFilter garantiza ser un objeto
            const columnName = Object.keys(safeFilter)[0];
            const searchValue = String(safeFilter[columnName as keyof FilterQuery<T>]);

            try {
                const rawArray = await this.gasService.findMany<any>(this.sheetName, columnName, searchValue);

                if (rawArray && rawArray.length > 0) {
                    // Usamos safeFilter aquí
                    const processedItems = await this.queryEngine.execute(rawArray, safeFilter, options);
                    return processedItems.map(raw => this.hydrateAndCacheRawResult<U>(raw, options));
                }
                return [];
            } catch (error: any) {
                this.logger.warn(`[Fallback] Búsqueda rápida GAS falló (${error.message}). Pasando a ruta local...`);
            }
        }

        // 🐢 CARRIL LENTO
        const rawItems = await this.fetchRawData(options?.includeInactive);

        // Usamos safeFilter aquí también
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
    async save(doc: U): Promise<U> {
        const pk = (doc as any)[this.getPrimaryKeyField()];
        const isNew = (doc as any)[ROW_INDEX_SYMBOL] === undefined;
        const operation: TypeOp = isNew ? TypeOp.INSERT : TypeOp.UPDATE;

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
            this.uow.register(doc, pk, this.entityClass);
            return doc;
        }

        this.logger.debug(`[Repository] Ejecución directa ${operation} en ${this.sheetName}`);
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
        const allRows = await this.gateway.getRange(`${this.sheetName}!A1:Z10000`);
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
}