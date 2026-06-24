import { Inject, Logger } from '@nestjs/common';
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

import { SheetDataGateway } from '../../infrastructure/sheet-api/sheet-data.gateway';
import { SheetDataTransformer } from '../base/sheetDataTransformer';
import { PopulateEngine } from '../engine/populate.engine';
import { RepositoryCoreFacade } from './repository-core.facade';
import { ISheetReadDriver } from '../../infrastructure/gas-web-app/gas-query.gateway';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { CacheKeys } from '../cache/cache.keys';
import { IdFactory } from '@sheetOdm/shared/id.generator';
import { EntityStore } from '../store/entity-store';
export const entityDataMap = new WeakMap<any, any>();
export class SheetsRepository<T extends object, U extends SheetDocument<T> = SheetDocument<T>> {
    private readonly logger: Logger;
    private readonly sheetName: string;
    private readonly metadata: MetadataRegistry;
    private readonly dataSource: DataSourceManager;
    private readonly uow: UnitOfWork;
    private readonly hydrator: SheetDocumentHydrator;
    private readonly queryEngine: QueryEngine;
    private readonly mutationEngine: MutationEngine;

    private readonly writeGateway: SheetDataGateway; // Google APIs para escrituras
    private readonly readGateway: ISheetReadDriver;  // GAS para lecturas indexadas (NUEVO)

    private readonly gateway: SheetDataGateway;
    private readonly transformer: SheetDataTransformer;
    private readonly populateEngine: PopulateEngine;
    private readonly metaDataRegistry: MetadataRegistry;
    private readonly cacheManager: Cache;

    constructor(
        public readonly entityClass: ClassType<T>,
        core: RepositoryCoreFacade, // 🚀 Solo inyectamos el Facade

    ) {
        this.logger = new Logger(`Repository<${this.entityClass.name}>`);
        this.metadata = core.metadata;
        this.dataSource = core.dataSource;
        this.uow = core.uow;
        this.hydrator = core.hydrator;
        this.queryEngine = core.queryEngine;
        this.mutationEngine = core.mutationEngine;

        // Separación explícita de carriles CQRS
        this.writeGateway = core.gateway;
        this.readGateway = core.readGateway;

        // 🔥 SOLUCIÓN: Asigna el gateway original para mantener la compatibilidad con tus métodos de escritura
        this.gateway = core.gateway;

        this.transformer = core.transformer;
        this.populateEngine = core.populateEngine;
        this.cacheManager = core.cacheManager;
        this.sheetName = this.metadata.getSchema(this.entityClass).sheetName;
    }

    private getCacheKey(): string {
        return CacheKeys.SHEET_DATA(this.sheetName);
    }

    /**
     * 🔍 BÚSQUEDA ÚNICA
     */
    async findOne(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<U | null> {
        if (this.canUseIndexedRead(filter, options)) {
            const propertyName = Object.keys(filter!)[0];
            const searchValue = String(filter![propertyName as keyof FilterQuery<T>]);

            const schema = this.metadata.getSchema(this.entityClass);
            const colConfig = schema.columns[propertyName];
            const columnName = (colConfig?.name || propertyName).toUpperCase();

            try {
                // 🚀 Usamos el nuevo readGateway
                const rawData = await this.readGateway.findOne<any>(this.sheetName, columnName, searchValue);

                if (rawData) {
                    this.logger.debug(`[Cache Hit - Read Gateway] Registro encontrado en ${this.sheetName}`);
                    return this.hydrateAndCacheRawResult<U>(rawData, options);
                }
                return null;
            } catch (error: any) {
                this.logger.warn(`[Fallback] Lectura indexada falló en findOne. Error: ${error.message}`);
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

        if (this.canUseIndexedRead(safeFilter, options)) {
            const propertyName = Object.keys(safeFilter)[0];
            const searchValue = String(safeFilter[propertyName as keyof FilterQuery<T>]);

            const schema = this.metadata.getSchema(this.entityClass);
            const colConfig = schema.columns[propertyName];
            const columnName = (colConfig?.name || propertyName).toUpperCase();

            try {
                // 🚀 Usamos el nuevo readGateway
                const rawArray = await this.readGateway.findMany<any>(this.sheetName, columnName, searchValue);

                if (rawArray && rawArray.length > 0) {
                    const processedItems = await this.queryEngine.execute(rawArray, safeFilter, options);
                    return processedItems.map(raw => this.hydrateAndCacheRawResult<U>(raw, options));
                }
                return [];
            } catch (error: any) {
                this.logger.warn(`[Fallback] Lectura indexada falló (${error.message}). Pasando a escaneo completo...`);
            }
        }

        const rawItems = await this.fetchRawData(options?.includeInactive);
        const processedItems = await this.queryEngine.execute(rawItems, safeFilter, options);
        const instances = processedItems.map(raw => this.hydrateAndCacheRawResult<U>(raw, options));

        if (options?.populate && instances.length > 0) {
            await this.populateEngine.populate<T, U>(
                instances,
                this.entityClass,
                options.populate as any
            );
        }

        return instances;
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
        this.logger.debug(`[FLOW-4] Objeto antes de serializar (Keys): ${Object.keys(doc)}`);
        const pkField = this.getPrimaryKeyField();
        const pk = doc.getPrimaryKeyValue(pkField as keyof T);
        // Verificar si el método existe antes de llamarlo
        if (typeof (doc as any).getPrimaryKeyValue !== 'function') {
            this.logger.error(`[FLOW-ERROR] ¡Error de prototipo! El objeto no tiene getPrimaryKeyValue`);
        }
        const rowIndex = doc.rowNumber;
        const isNew = rowIndex === undefined;
        const operation: TypeOp = isNew ? TypeOp.INSERT : TypeOp.UPDATE;

        // 1. Obtenemos el payload completo (Padre + posibles hijos anidados)
        const rawPayload = doc.toJSON() as any;
        const payload = { ...rawPayload };
        if (rowIndex !== undefined) {
            payload._row = rowIndex;
        }

        // 2. Arreglo para almacenar las mutaciones de los hijos extraídos
        const childMutations: { entityClass: ClassType<any>; payload: any; operation: TypeOp }[] = [];

        // 3. 🔍 INSPECCIÓN DE METADATOS: Buscamos las SubColecciones
        const relations = this.metadata.getCompiledRelations(this.entityClass);

        for (const rel of relations) {
            // Si es subcolección y los datos vinieron en el JSON...
            if (rel.type === 'subcollection' && payload[rel.propertyName]) {
                const childrenArray = payload[rel.propertyName];

                if (Array.isArray(childrenArray)) {
                    const TargetEntityClass = rel.targetEntity();

                    // Obtenemos la columna foránea (ej. idObrero)
                    const joinColName = rel.joinColumn || `${this.entityClass.name.toLowerCase()}Id`;

                    for (const child of childrenArray) {
                        // 💉 MAGIA: Inyectamos automáticamente el ID del padre en el hijo
                        child[joinColName] = pk;

                        childMutations.push({
                            entityClass: TargetEntityClass,
                            payload: child,
                            // Si el hijo no tiene _row, es un INSERT, si no, es UPDATE
                            operation: child._row === undefined ? TypeOp.INSERT : TypeOp.UPDATE
                        });
                    }
                }

                // 🧹 CRÍTICO: Borramos el array del payload del padre. 
                // Esto evita que intentemos guardar un Array en una celda de Sheets.
                delete payload[rel.propertyName];
            }
        }

        // =========================================================
        // 4. DESPACHO TRANSACCIONAL (UoW)
        // =========================================================
        if (this.uow.hasActiveTransaction()) {
            // A. Encolar al padre limpio
            this.uow.queueOperation({
                type: operation,
                entityClass: this.entityClass,
                sheetName: this.sheetName,
                // 🔥 SOLUCIÓN: Pasamos el objeto plano directamente
                doc: rawPayload,
                pk: pk
            });

            // B. Encolar a todos los hijos extraídos
            for (const childMut of childMutations) {
                const childPkField = this.metadata.getPrimaryKeyField(childMut.entityClass);
                const childPk = childMut.payload[childPkField];
                const childSheetName = this.metadata.getSchema(childMut.entityClass).sheetName;
                this.uow.queueOperation({
                    type: childMut.operation,
                    entityClass: childMut.entityClass,
                    sheetName: childSheetName,
                    // 🔥 SOLUCIÓN: Pasamos el payload del hijo directamente
                    doc: childMut.payload,
                    pk: childPk
                });
            }

            this.uow.register(doc, pk, this.entityClass);
            return doc;
        }

        // =========================================================
        // 5. DESPACHO DIRECTO (Sin UoW)
        // =========================================================
        // A. Despachamos al padre
        // const serializedPayload = this.metadata.serialize(rawPayload, this.entityClass);

        await this.dataSource.dispatchMutation(
            this.entityClass,
            operation,
            rawPayload,
            rawPayload
        );

        // B. Despachamos a los hijos como tareas independientes a la Outbox
        for (const childMut of childMutations) {
            // const serializedChild = this.metadata.serialize(childMut.payload, childMut.entityClass);

            await this.dataSource.dispatchMutation(
                childMut.entityClass,
                childMut.operation,
                childMut.payload,
                childMut.payload
            );
        }

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
        // 1. Simplificación de la lógica del ID
        const generatedId = (data as any).id || IdFactory.createShort() || Math.random().toString(36).substring(2, 10).toUpperCase();

        const payload = {
            ...data,
            id: generatedId
        };

        // 2. Hydratamos y hacemos el casting explícito a U
        // El "as U" le dice al compilador que deje de preocuparse.
        const instance = this.hydrator.hydrateAndShield(
            this.entityClass,
            this,
            payload,
            { new: true }
        ) as U;

        // 3. Guardamos en el Store centralizado
        EntityStore.set(instance as any, payload);

        return instance;
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
        const cacheKey = this.getCacheKey();

        // 1. Intentar obtener de caché
        const cachedData = await this.cacheManager.get<any[]>(cacheKey);
        if (cachedData) {
            this.logger.debug(`[Cache Hit] Datos obtenidos de memoria para: ${this.sheetName}`);
            return cachedData;
        }

        // 2. Fallback a Google Sheets (GateWay)
        this.logger.debug(`[Cache Miss] Escaneando hoja: ${this.sheetName}`);
        const bounds = await this.gateway.getBoundaries(this.sheetName);
        const colLetter = String.fromCharCode(64 + bounds.lastColumn);
        const perfectRange = `${this.sheetName}!A1:${colLetter}${bounds.lastRow}`;
        const allRows = await this.gateway.getRange(perfectRange);

        if (!allRows || allRows.length === 0) return [];

        const headers = allRows[0].map((h: any) => String(h).trim().toUpperCase());
        const dataRows = allRows.slice(1);
        const schema = this.metadata.getSchema(this.entityClass);

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

        // 3. Guardar en caché (TTL configurable, ej: 5 min)
        await this.cacheManager.set(cacheKey, items, 300000);

        return items;
    }

    /**
     * 📝 ESCRITURA Y PURGA DE CACHÉ
     */
    async commitBulk(documents: any[]): Promise<void> {
        if (!documents || documents.length === 0) return;

        const inserts = documents.filter(doc => !doc[ROW_INDEX_SYMBOL]);
        const updates = documents.filter(doc => doc[ROW_INDEX_SYMBOL] && !doc.deleted);
        const deletes = documents.filter(doc => doc[ROW_INDEX_SYMBOL] && doc.deleted);

        try {
            if (deletes.length > 0) await this.processDeletes(deletes);
            if (updates.length > 0) await this.processUpdates(updates);
            if (inserts.length > 0) await this.processInserts(inserts);

            // ✅ INVALIDACIÓN CRÍTICA: La base de datos cambió, la caché debe morir.
            await this.cacheManager.del(this.getCacheKey());

            this.logger.debug(`[commitBulk] Lote procesado e invalidada caché para: ${this.sheetName}`);
        } catch (error: any) {
            this.logger.error(`[commitBulk] Error: ${error.message}`);
            throw error;
        }
    }

    private canUseIndexedRead(filter?: FilterQuery<T>, options?: QueryOptions<T>): boolean {
        if (!filter || Object.keys(filter).length !== 1) return false;
        if (options?.sort) return false;

        const value = Object.values(filter)[0];
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    }

    private getPrimaryKeyField(): string {
        return this.metadata.getPrimaryKeyField(this.entityClass);
    }


    private async processDeletes(docs: any[]): Promise<void> {
        const deleteControlProp = this.metadata.getDeleteControlProperty(this.entityClass);
        const hardDeleteRanges: string[] = [];
        const softDeleteDocs: SheetDocument<T>[] = [];

        for (const doc of docs) {
            const rowIndex = doc[ROW_INDEX_SYMBOL];
            if (deleteControlProp) {
                // Soft delete: Actualizar celda a true y encolar el documento
                doc[deleteControlProp] = true;
                if (doc.version !== undefined && typeof doc.setVersion === 'function') {
                    doc.setVersion(doc.version + 1);
                }
                softDeleteDocs.push(doc as SheetDocument<T>);
            } else {
                // Hard delete: Limpiar fila
                hardDeleteRanges.push(`${this.sheetName}!${rowIndex}:${rowIndex}`);
            }
        }

        // Ejecutamos Hard Deletes
        if (hardDeleteRanges.length > 0) {
            await this.gateway.batchClearValues(hardDeleteRanges);
        }

        // Ejecutamos Soft Deletes utilizando nuestro builder empresarial
        if (softDeleteDocs.length > 0) {
            const softDeleteUpdates = this.buildGoogleBatchRequests(softDeleteDocs);
            await this.gateway.batchUpdateValues(softDeleteUpdates);
        }
    }

    private async processUpdates(docs: any[]): Promise<void> {
        // 1. Incremento de versión (Optimistic Locking) antes de serializar
        docs.forEach(doc => {
            if (doc.version !== undefined && typeof doc.setVersion === 'function') {
                doc.setVersion(doc.version + 1);
            }
        });

        // 2. Construcción de la petición usando el método empresarial
        // Hacemos el cast a SheetDocument<T>[] ya que provienen de commitBulk como any[]
        const payloads = this.buildGoogleBatchRequests(docs as SheetDocument<T>[]);

        // 3. Ejecución contra el Gateway
        if (payloads.length > 0) {
            await this.gateway.batchUpdateValues(payloads);
        }
    }

    private async processInserts(docs: SheetDocument<T>[]): Promise<void> {
        if (!docs || docs.length === 0) return;

        const schema = this.metadata.getSchema(this.entityClass);
        const versionField = this.metadata.getVersionField(this.entityClass);

        // 1. Convertimos los documentos a la matriz exacta que espera Google Sheets
        const rowsToInsert: any[][] = docs.map(doc => {
            // 🔥 ESTA ES LA CLAVE: Usamos el serializador del MetadataRegistry
            return this.metadata.serialize(doc as unknown as T, this.entityClass);
        });

        try {
            this.logger.debug('PAYLOAD A ENVIAR A GOOGLE:', JSON.stringify(rowsToInsert, null, 2));
            const insertedRowNumbers = await this.gateway.appendRows(this.sheetName, rowsToInsert);

            if (insertedRowNumbers && insertedRowNumbers.length === docs.length) {
                docs.forEach((doc, idx) => {
                    doc.markAsSaved(insertedRowNumbers[idx]);
                });
            }
        } catch (error: any) {
            this.logger.error(`Error procesando inserts masivos en ${this.sheetName}: ${error.message}`);
            throw error;
        }
    }


    protected async getRawData(includeInactive = false): Promise<Record<string, any>[]> {
        const cacheKey = this.getCacheKey();

        // 1. Hit de Caché
        const cachedData = await this.cacheManager.get<Record<string, any>[]>(cacheKey);
        if (cachedData) {
            return cachedData;
        }

        this.logger.debug(`[Cache Miss] Fetching fresh data from: ${this.sheetName}`);

        // 2. Obtener límites de la hoja para construir un rango dinámico y preciso
        const bounds = await this.gateway.getBoundaries(this.sheetName);

        // Si la hoja está vacía o solo tiene cabeceras (lastRow <= 1)
        if (bounds.lastRow <= 1) return [];

        // Convertimos el índice de columna a letra (ej: 3 -> 'C')
        const lastColLetter = this.numberToColumn(bounds.lastColumn);
        const perfectRange = `${this.sheetName}!A1:${lastColLetter}${bounds.lastRow}`;

        const allRows = await this.gateway.getRange(perfectRange);
        if (!allRows || allRows.length === 0) return [];

        // 3. Mapeo inteligente usando MetadataRegistry
        const [headerRow, ...dataRows] = allRows;
        const schema = this.metadata.getSchema(this.entityClass);

        // Convertimos headers a mayúsculas para comparación insensible a mayúsculas
        const headers = headerRow.map((h: any) => String(h).trim().toUpperCase());

        const rawCollection: Record<string, any>[] = dataRows.map((row, index) => {
            const obj: Record<string | symbol, any> = {};

            // Asignamos el índice de fila física (+2 porque sheets es 1-based y saltamos cabecera)
            obj[ROW_INDEX_SYMBOL] = index + 2;

            // Iteramos sobre las propiedades definidas en el decorador @Column
            for (const propertyName of Object.keys(schema.columns)) {
                const colConfig = schema.columns[propertyName];
                const sheetColumnName = (colConfig.name || propertyName).toUpperCase();

                const colIndex = headers.indexOf(sheetColumnName);

                // Si la columna existe en el sheet, la mapeamos, sino usamos el valor default
                obj[propertyName] = colIndex !== -1 ? row[colIndex] : (colConfig.default ?? null);
            }

            return obj;
        });

        // 4. Filtrado de registros inactivos (si aplica)
        let processedData = rawCollection;
        const deleteControlProp = schema.deleteControl;
        if (deleteControlProp && !includeInactive) {
            processedData = processedData.filter(item => !item[deleteControlProp]);
        }

        // 5. Guardamos en caché (5 min TTL)
        await this.cacheManager.set(cacheKey, processedData, 300000);

        return processedData;
    }

    /**
     * Helper para convertir índice numérico de columna a letra (ej: 1 -> A, 27 -> AA)
     */
    private numberToColumn(num: number): string {
        let letter = '';
        while (num > 0) {
            const charCode = (num - 1) % 26;
            letter = String.fromCharCode(65 + charCode) + letter;
            num = Math.floor((num - 1) / 26);
        }
        return letter;
    }

    private buildGoogleBatchRequests(documents: SheetDocument<T>[]): { range: string, values: any[][] }[] {
        const requests: { range: string, values: any[][] }[] = [];
        const schema = this.metadata.getSchema(this.entityClass);

        documents.forEach(doc => {
            const rowIndex = (doc as any)[ROW_INDEX_SYMBOL];
            if (!rowIndex) return;

            // 🔥 USAMOS EL SERIALIZADOR: Devuelve el array en el orden correcto
            const rowData = this.metadata.serialize(doc as unknown as T, this.entityClass);

            const lastCol = this.numberToColumn(rowData.length);
            const range = `${this.sheetName}!A${rowIndex}:${lastCol}${rowIndex}`;

            requests.push({
                range,
                values: [rowData]
            });
        });

        return requests;
    }
}