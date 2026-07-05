import { Logger } from '@nestjs/common';
import { MetadataRegistry } from '../metadata/metadata.registry';
import { DataSourceManager } from '../data-source-manager';
import { UnitOfWork } from '../uow/services/unit-of-work.service';
import { ClassType } from '../types/common.types';
import { ROW_INDEX_SYMBOL, SHEETS_COLUMN_DETAILS } from '../../shared/constants/constants';
import { TypeOp } from '../outbox/interfaces/outbox-entry.interface';
import { SheetDocument } from '../wrapper/sheet-document';
import { FilterQuery, FindOneAndUpdateOptions, QueryOptions, UpdateQuery } from '../model/model.factory';
import { QueryEngine } from '../query/query.engine';
import { MutationEngine } from '../engine/mutationEngine';
import { PopulateEngine } from '../engine/populate.engine';
import { RepositoryCoreFacade } from './repository-core.facade';
import { Cache } from 'cache-manager';
import { CacheKeys } from '../cache/cache.keys';
import { IdFactory } from '@sheetOdm/shared/id.generator';
import { EntityStore } from '../store/entity-store';
import { AggregationBuilder } from '../../stages/aggregation.builder';
import { AggregationFactory } from '../../stages/interfaces/aggregation.factory';

export const entityDataMap = new WeakMap<any, any>();
export class SheetsRepository<T extends object, U extends SheetDocument<T> = SheetDocument<T>> {
    private readonly logger: Logger;
    private readonly sheetName: string;
    private readonly metadata: MetadataRegistry;
    private readonly dataSource: DataSourceManager;
    private readonly uow: UnitOfWork;
    private readonly queryEngine: QueryEngine;
    private readonly mutationEngine: MutationEngine;
    private readonly populateEngine: PopulateEngine;
    private readonly cacheManager: Cache;
    private readonly aggregationFactory: AggregationFactory;

    constructor(
        public readonly entityClass: ClassType<T>,
        core: RepositoryCoreFacade, // 🚀 Solo inyectamos el Facade

    ) {
        this.logger = new Logger(`Repository<${this.entityClass.name}>`);
        this.metadata = core.metadata;
        this.dataSource = core.dataSource;
        this.uow = core.uow;
        this.queryEngine = core.queryEngine;
        this.mutationEngine = core.mutationEngine;
        this.populateEngine = core.populateEngine;
        this.cacheManager = core.cacheManager;
        this.aggregationFactory = core.aggregationFactory;
        this.sheetName = this.metadata.getSchema(this.entityClass).sheetName;
    }

    private getCacheKey(): string {
        return CacheKeys.SHEET_DATA(this.sheetName);
    }

    /**
     * 🔍 BÚSQUEDA ÚNICA
     */
    async findOne(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<U | null> {
        // 1. Intentar lectura indexada (Camino rápido)
        if (this.canUseIndexedRead(filter, options)) {
            const propertyName = Object.keys(filter!)[0];
            const searchValue = String(filter![propertyName as keyof FilterQuery<T>]);

            const schema = this.metadata.getSchema(this.entityClass);
            const colConfig = schema.columns[propertyName];
            const columnName = (colConfig?.name || propertyName).toUpperCase();

            try {
                const rawData = await this.dataSource.executeWithRetry(
                    () => this.dataSource.readFindOne<any>(this.sheetName, columnName, searchValue),
                    `Indexed FindOne [${this.sheetName}]`
                );

                if (rawData) {
                    const instance = this.hydrateAndCacheRawResult<U>(rawData, options);
                    // Aplicar población automática en el camino indexado
                    await this.applyPopulation([instance], options);
                    return instance;
                }
            } catch (error: any) {
                this.logger.warn(`[Fallback] Lectura indexada falló en findOne (${error.message}).`);
            }
        }

        // 2. Fallback: Usar el método find (Camino lento pero seguro)
        // Como find() ahora es autónomo, llamarlo aquí resuelve automáticamente la población
        const results = await this.find(filter, { ...options, limit: 1 });
        return results.length > 0 ? (results[0] as U) : null;
    }

    /**
     * 🔍 BÚSQUEDA MÚLTIPLE
     */
    async find(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<U[]> {
        const safeFilter = filter || ({} as FilterQuery<T>);
        this.logger.debug(`[FIND] Iniciando búsqueda en [${this.sheetName}]. Filtro: ${JSON.stringify(safeFilter)}`);
        let instances: U[] = [];

        // 1. Determinar estrategia de búsqueda (Indexada vs Escaneo)
        if (this.canUseIndexedRead(safeFilter, options)) {
            const propertyName = Object.keys(safeFilter)[0];
            const searchValue = String(safeFilter[propertyName as keyof FilterQuery<T>]);

            const schema = this.metadata.getSchema(this.entityClass);
            const colConfig = schema.columns[propertyName];
            const columnName = (colConfig?.name || propertyName).toUpperCase();

            try {
                const rawArray = await this.dataSource.executeWithRetry(
                    () => this.dataSource.readFindMany<any>(this.sheetName, columnName, searchValue),
                    `Indexed FindMany [${this.sheetName}]`
                );

                if (rawArray && rawArray.length > 0) {
                    this.logger.debug(`[FIND] Sheets retornó ${rawArray.length} filas crudas (Indexadas). Muestra de cabeceras: ${Object.keys(rawArray[0])}`);
                    // 🔄 Aquí ocurre la magia: rawArray (SNAKE) -> mapeado e instanciado (camelCase)
                    const mappedInstances = rawArray.map(raw => this.hydrateAndCacheRawResult<U>(raw, options));

                    // El QueryEngine ahora puede filtrar con { idObrero: ... } porque procesa instancias limpias
                    instances = await this.queryEngine.execute(mappedInstances, safeFilter, options);
                }
            } catch (error: any) {
                this.logger.warn(`[Fallback] Lectura indexada masiva falló. Pasando a escaneo total...`);
            }
        }

        // Si no se usó el índice o el índice no trajo resultados, hacer escaneo total
        if (instances.length === 0) {
            const rawItems = await this.fetchRawData(options?.includeInactive);
            if (rawItems.length > 0) {
                this.logger.debug(`[FIND] Sheets retornó ${rawItems.length} filas crudas (Escaneo). Muestra de cabeceras: ${Object.keys(rawItems[0])}`);
            }

            // 🔄 Lo mismo para el escaneo total
            const mappedInstances = rawItems.map(raw => this.hydrateAndCacheRawResult<U>(raw, options));

            instances = await this.queryEngine.execute(mappedInstances, safeFilter, options);
        }

        // 2. Auto-Populación
        // 'instances' va cargado con objetos TypeScript puros que el PopulateEngine entiende perfectamente.
        await this.applyPopulation(instances, options);

        if (instances.length > 0 && this.sheetName === 'obreros') { // Ejemplo con obreros
            const muestra = instances[0] as any;
            this.logger.debug(`[POPULATE] Primer obrero resultado: ID=${muestra.id}, Adelantos Cargados=${muestra.adelantos?.length || 0}`);
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
            // Ahora consume el método refactorizado limpio
            const rawItems = await this.fetchRawData(false);
            return await this.queryEngine.aggregate(rawItems, pipeline) as R[];
        } catch (error: any) {
            this.logger.error(`❌ Error en aggregate() en "${this.sheetName}": ${error.message}`);
            throw error;
        }
    }

    private async applyPopulation(instances: U[], options?: QueryOptions<T>): Promise<void> {
        if (options?.populate && instances.length > 0) {
            await this.populateEngine.populate<T, U>(
                instances,
                this.entityClass,
                options.populate as any
            );
        }
    }

    /**
     * 📝 GUARDAR (UoW o Directo)
     */
    async save(doc: SheetDocument<T>): Promise<SheetDocument<T>> {
        // Guardrail defensivo de prototipos antes de extraer propiedades
        if (!doc || typeof doc.getPrimaryKeyValue !== 'function') {
            throw new Error(`[OdmError] Estructura inválida. El objeto no hereda de SheetDocument.`);
        }

        const pkField = this.getPrimaryKeyField();
        const pk = doc.getPrimaryKeyValue(pkField as keyof T);
        const rowIndex = doc.rowNumber;
        const isNew = rowIndex === undefined;
        const operation: TypeOp = isNew ? TypeOp.INSERT : TypeOp.UPDATE;

        const rawPayload = doc.toJSON() as any;
        const payload = { ...rawPayload };
        if (rowIndex !== undefined) {
            payload._row = rowIndex;
        }

        const childMutations: { entityClass: ClassType<any>; payload: any; operation: TypeOp }[] = [];
        const relations = this.metadata.getCompiledRelations(this.entityClass);

        // 🔀 DISEÑO TAB-TO-TAB: Procesamiento estricto de subcolecciones como pestañas independientes
        for (const rel of relations) {
            if (rel.type === 'subcollection' && payload[rel.propertyName]) {
                const childrenArray = payload[rel.propertyName];

                if (Array.isArray(childrenArray)) {
                    const TargetEntityClass = rel.targetEntity();
                    const joinColName = rel.joinColumn || `${this.entityClass.name.toLowerCase()}Id`;

                    for (const child of childrenArray) {
                        child[joinColName] = pk; // Inyectar id del padre en la fila de la pestaña hija
                        childMutations.push({
                            entityClass: TargetEntityClass,
                            payload: child,
                            operation: child._row === undefined ? TypeOp.INSERT : TypeOp.UPDATE
                        });
                    }
                }
                // 🧹 Sanitización: Borramos el array para que no intente guardarse en una celda de la pestaña padre
                delete payload[rel.propertyName];
            }
        }

        // 🏢 FLUJO A: DESPACHO TRANSACCIONAL (Unit of Work)
        if (this.uow.hasActiveTransaction()) {
            this.uow.queueOperation({
                type: operation,
                entityClass: this.entityClass,
                sheetName: this.sheetName,
                doc: payload,
                pk: pk
            });

            for (const childMut of childMutations) {
                const childSheetName = this.metadata.getSchema(childMut.entityClass).sheetName;
                const childPkField = this.metadata.getPrimaryKeyField(childMut.entityClass);
                this.uow.queueOperation({
                    type: childMut.operation,
                    entityClass: childMut.entityClass,
                    sheetName: childSheetName,
                    doc: childMut.payload,
                    pk: childMut.payload[childPkField]
                });
            }

            this.uow.register(doc, pk, this.entityClass);
            return doc;
        }

        // ⚡ FLUJO B: DESPACHO DIRECTO AL DSM (Postgres Outbox / Concurrente)
        await this.dataSource.dispatchMutation(this.entityClass, operation, payload, payload);

        for (const childMut of childMutations) {
            await this.dataSource.dispatchMutation(childMut.entityClass, childMut.operation, childMut.payload, childMut.payload);
        }

        return doc;
    }

    /**
     * 🗑️ ELIMINAR
     */
    async delete(doc: U): Promise<boolean> {
        const pk = doc.getPrimaryKeyValue(this.getPrimaryKeyField() as keyof T);

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
        const generatedId = (data as any).id || IdFactory.createShort();

        const payload = {
            ...data,
            id: generatedId
        };

        // Instanciamos el documento pasándole 'this' (el repositorio) para activar el patrón Active Record
        const instance = new (this.entityClass as any)(payload, this, true) as U;
        EntityStore.set(instance as any, payload);

        return instance;
    }

    // ====================================================================
    // HELPERS INTERNOS
    // ====================================================================

    private hydrateAndCacheRawResult<Ret extends U = U>(rawObject: any, options?: QueryOptions<T>): Ret {
        if (!rawObject) return null as any;

        // 1. Evitamos mutar el objeto original creando una copia superficial segura
        const targetRaw = { ...rawObject };

        if (targetRaw._row !== undefined && targetRaw._row !== null) {
            targetRaw[ROW_INDEX_SYMBOL] = targetRaw._row;
            delete targetRaw._row; // Ahora es seguro eliminarlo porque es nuestra copia
        }

        // 2. Mapeamos los datos de SNAKE_CASE a camelCase usando tu infraestructura
        const cleanData = this.metadata.mapRawToEntity(targetRaw, this.entityClass);
        if (this.sheetName === 'adelantos') { // O la pestaña que estés debugueando
            this.logger.verbose(`[HYDRATE] Datos convertidos a CamelCase: ${JSON.stringify(cleanData)}`);
        }
        const pkField = this.getPrimaryKeyField();
        const pkValue = cleanData[pkField as keyof typeof cleanData] as string | number;

        // 3. Instanciamos con el patrón Active Record de tu ODM
        const doc = new (this.entityClass as any)(this, false) as Ret;
        Object.assign(doc, cleanData);

        // 4. Inicializamos relaciones como arreglos vacíos de forma preventiva
        const relations = this.metadata.getCompiledRelations(this.entityClass);
        for (const rel of relations) {
            if (rel.isMany) {
                (doc as any)[rel.propertyName] = [];
            }
        }

        // 5. Registro seguro en la Unidad de Trabajo (Unit of Work)
        if (pkValue) {
            this.uow.register(doc, pkValue, this.entityClass);
        }

        return doc;
    }



    async clearRepositoryCache(): Promise<void> {
        await this.cacheManager.del(this.getCacheKey());
        this.logger.debug(`[Cache Purged] Memoria invalidada para la pestaña: ${this.sheetName}`);
    }

    protected async fetchRawData(includeInactive = false): Promise<any[]> {
        const cacheKey = this.getCacheKey();

        // 1. Intentar obtener de caché
        const cachedData = await this.cacheManager.get<any[]>(cacheKey);
        if (cachedData) {
            this.logger.debug(`[Cache Hit] Datos obtenidos de memoria para: ${this.sheetName}`);
            return cachedData;
        }

        // 2. Fallback al DataSourceManager (La lógica de rangos y letras ya no vive aquí)
        this.logger.debug(`[Cache Miss] Solicitando filas crudas al DSM para: ${this.sheetName}`);

        let items = await this.dataSource.readFindAll<any>(this.sheetName);

        // Protección por si el DSM devuelve nulo
        if (!items) {
            items = [];
        }

        // 3. Aplicar Soft-Delete (Lógica de Negocio)
        const schema = this.metadata.getSchema(this.entityClass);
        const deleteControlProp = schema.deleteControl;

        if (deleteControlProp && !includeInactive && items.length > 0) {
            items = items.filter(item => !item[deleteControlProp]);
        }

        // 4. Guardar en caché delegando el TTL al módulo global
        await this.cacheManager.set(cacheKey, items);

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


    private async processInserts(docs: SheetDocument<T>[]): Promise<void> {
        if (!docs || docs.length === 0) return;

        await Promise.all(docs.map(async (doc) => {
            const payload = doc.toJSON();
            const rawRowValues = this.metadata.serialize(doc as unknown as T, this.entityClass);

            await this.dataSource.dispatchMutation(
                this.entityClass,
                'INSERT' as TypeOp, // Ajusta a tu enum: ej. TypeOp.INSERT
                payload,
                rawRowValues        // El array plano listo para que el trigger haga .appendRow()
            );

            // 💡 CONVENCIÓN WAL (Write-Ahead Log): 
            // Como la escritura física es asíncrona, le asignamos un rowIndex temporal de -1 
            // indicando: "Guardado en Outbox, pendiente de sincronización física".
            doc.markAsSaved(-1);
        }));
    }

    private async processUpdates(docs: any[]): Promise<void> {
        if (!docs || docs.length === 0) return;

        await Promise.all(docs.map(async (doc: SheetDocument<T>) => {
            // 1. Optimistic Locking
            if (doc.version !== undefined && typeof doc.setVersion === 'function') {
                doc.setVersion(doc.version + 1);
            }

            const payload = doc.toJSON();
            const rawRowValues = this.metadata.serialize(doc as unknown as T, this.entityClass);
            const rowIndex = (doc as any)[ROW_INDEX_SYMBOL];

            // 🎁 REGALO PARA EL CONSUMIDOR DEL OUTBOX:
            // Le pasamos el rowIndex físicamente en el rawDoc para que Apps Script 
            // no tenga que hacer un .find() buscando el ID por toda la hoja.
            const outboxRawDoc = {
                rowIndex,
                values: rawRowValues
            };

            await this.dataSource.dispatchMutation(
                this.entityClass,
                'UPDATE' as TypeOp,
                payload,
                outboxRawDoc
            );
        }));
    }

    private async processDeletes(docs: any[]): Promise<void> {
        if (!docs || docs.length === 0) return;

        const deleteControlProp = this.metadata.getDeleteControlProperty(this.entityClass);

        await Promise.all(docs.map(async (doc: SheetDocument<T>) => {
            const rowIndex = (doc as any)[ROW_INDEX_SYMBOL];

            if (deleteControlProp) {
                // --- 🟡 SOFT DELETE (Físicamente es un UPDATE) ---
                doc[deleteControlProp as keyof SheetDocument<T>] = true as any;
                if (doc.version !== undefined && typeof doc.setVersion === 'function') {
                    doc.setVersion(doc.version + 1);
                }

                const payload = doc.toJSON();
                const rawRowValues = this.metadata.serialize(doc as unknown as T, this.entityClass);

                await this.dataSource.dispatchMutation(
                    this.entityClass,
                    'UPDATE' as TypeOp, // Despachamos un UPDATE porque Sheets solo actualizará la celda
                    payload,
                    { rowIndex, values: rawRowValues }
                );
            } else {
                // --- 🔴 HARD DELETE (Físicamente destruir la fila) ---
                const payload = doc.toJSON();

                await this.dataSource.dispatchMutation(
                    this.entityClass,
                    'DELETE' as TypeOp,
                    payload,
                    { rowIndex } // Al trigger de borrado solo le interesa saber el número de fila
                );
            }
        }));
    }



    createAggregation(): AggregationBuilder {
        return this.aggregationFactory.create();
    }


}