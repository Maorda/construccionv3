import { Logger } from '@nestjs/common';
import { MetadataRegistry } from '../../JoinSheetTabs/metadata.registry';
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
import { JoinSheetTabsService } from '@sheetOdm/JoinSheetTabs/JoinSheetTabsService';
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

    // 🚀 NUEVO: Propiedad privada para el motor de Joins de pestañas
    private readonly joinSheetTabsService: JoinSheetTabsService;

    private documentModelConstructor?: any; // ✨ 1. Guardará la referencia al DocumentModel

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

        // 🚀 NUEVO: Extracción limpia desde la Fachada central sin alterar la firma del constructor
        this.joinSheetTabsService = core.joinSheetTabsService;

        this.sheetName = this.metadata.getSchema(this.entityClass).sheetName;
    }

    // ✨ 2. Método para vincular el modelo enriquecido al repositorio
    public bindModel(modelConstructor: any): void {
        this.documentModelConstructor = modelConstructor;
    }

    // ✨ 3. Helper para obtener el constructor correcto (Prioridad: Custom > DocumentModel > Entity pura)
    private getDocumentConstructor(options?: QueryOptions<T>): any {
        return options?.customConstructor || this.documentModelConstructor || this.entityClass;
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

                    // 🔄 Modificado: Centralizado en applyRelations para resolver tanto Populate como el nuevo Join
                    await this.applyRelations([instance], options);
                    return instance;
                }
            } catch (error: any) {
                this.logger.warn(`[Fallback] Lectura indexada falló en findOne (${error.message}).`);
            }
        }

        // 2. Fallback: Usar el método find (Camino lento pero seguro)
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
                    this.logger.debug(`[FIND] Sheets retornó ${rawArray.length} filas crudas (Indexadas).`);
                    const mappedInstances = rawArray.map(raw => this.hydrateAndCacheRawResult<U>(raw, options));
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
                this.logger.debug(`[FIND] Sheets retornó ${rawItems.length} filas crudas (Escaneo).`);
            }

            const mappedInstances = rawItems.map(raw => this.hydrateAndCacheRawResult<U>(raw, options));
            instances = await this.queryEngine.execute(mappedInstances, safeFilter, options);
        }

        // 2. 🚀 Orquestación y carga de relaciones (Populate tradicional + Nuevos Joins modulares)
        await this.applyRelations(instances, options);

        if (instances.length > 0 && this.sheetName === 'obreros') {
            const muestra = instances[0] as any;
            this.logger.debug(`[RELATIONS] Primer obrero procesado: ID=${muestra.id}`);
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
                const initialData = this.mutationEngine.mutate(update, filter as Partial<T>);
                const newDoc = this.create(initialData) as U;
                return await newDoc.save();
            }
            return null;
        }

        const originalPlainData = { ...found.toJSON() };
        const mutatedData = this.mutationEngine.mutate(update, found.toJSON());
        Object.assign(found, mutatedData);

        const savedDoc = await found.save();

        if (options.new === false) {
            const Constructor = this.getDocumentConstructor(options);
            const oldDoc = new Constructor(originalPlainData, this, false) as U;
            return oldDoc;
        }

        return savedDoc;
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
     * 🚀 NUEVO / REFACORIZADO: Centralizador de resoluciones relacionales de lectura
     */
    private async applyRelations(instances: U[], options?: QueryOptions<T>): Promise<void> {
        if (!instances || instances.length === 0) return;

        // Flujo A: Populate nativo por Engine clásico
        // 🛡️ CORRECCIÓN: Dejamos this.entityClass intacto. Tu motor ya espera ClassType<T> aquí.
        if (options?.populate) {
            await this.populateEngine.populate<T, U>(
                instances,
                this.entityClass,
                options.populate as any
            );
        }

        // Flujo B: 🚀 Nuevo procesamiento modular del JoinSheetTabsModule
        // Funciona sin casteos gracias a la nueva firma resolveJoins<T, U> del servicio
        if (this.joinSheetTabsService && typeof this.joinSheetTabsService.resolveJoins === 'function') {
            await this.joinSheetTabsService.resolveJoins(instances, this.entityClass, options);
        }
    }

    /**
     * 📝 GUARDAR (UoW o Directo)
     */
    async save(doc: SheetDocument<T>): Promise<SheetDocument<T>> {
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

        // 🔀 DISEÑO TAB-TO-TAB: Procesamiento estricto de subcolecciones
        for (const rel of relations) {
            if (rel.type === 'subcollection' && payload[rel.propertyName]) {
                const childrenArray = payload[rel.propertyName];

                if (Array.isArray(childrenArray)) {
                    const TargetEntityClass = rel.targetEntity();
                    const joinColName = rel.joinColumn || `${this.entityClass.name.toLowerCase()}Id`;

                    for (const child of childrenArray) {
                        child[joinColName] = pk;
                        childMutations.push({
                            entityClass: TargetEntityClass,
                            payload: child,
                            operation: child._row === undefined ? TypeOp.INSERT : TypeOp.UPDATE
                        });
                    }
                }
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

        // ⚡ FLUJO B: DESPACHO DIRECTO AL DSM
        await this.dataSource.dispatchMutation(this.entityClass, operation, payload, payload);

        for (const childMut of childMutations) {
            await this.dataSource.dispatchMutation(childMut.entityClass, childMut.operation, childMut.payload, childMut.payload);
        }

        return doc;
    }

    /**
     * 🗑️ ELIMINAR (Con soporte opcional para Cascading Deletes del nuevo módulo)
     */
    async delete(doc: U): Promise<boolean> {
        const pk = doc.getPrimaryKeyValue(this.getPrimaryKeyField() as keyof T);

        // 🚀 NUEVO HOOK RELACIONAL: Ahora pasa limpiamente gracias al desacoplamiento en el servicio
        if (this.joinSheetTabsService && typeof this.joinSheetTabsService.handleCascadeDelete === 'function') {
            await this.joinSheetTabsService.handleCascadeDelete(doc, this.entityClass);
        }

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

        const Constructor = this.getDocumentConstructor();
        const instance = new Constructor(payload, this, true) as U;
        EntityStore.set(instance as any, payload);
        return instance;
    }

    // ====================================================================
    // HELPERS INTERNOS
    // ====================================================================

    private hydrateAndCacheRawResult<Ret extends U = U>(rawObject: any, options?: QueryOptions<T>): Ret {
        if (!rawObject) return null as any;

        const targetRaw = { ...rawObject };

        if (targetRaw._row !== undefined && targetRaw._row !== null) {
            targetRaw[ROW_INDEX_SYMBOL] = targetRaw._row;
            delete targetRaw._row;
        }

        const cleanData = this.metadata.mapRawToEntity(targetRaw, this.entityClass);
        const pkField = this.getPrimaryKeyField();
        const pkValue = cleanData[pkField as keyof typeof cleanData] as string | number;

        const Constructor = this.getDocumentConstructor(options);
        const doc = new Constructor(cleanData, this, false) as Ret;
        Object.assign(doc, cleanData);

        const relations = this.metadata.getCompiledRelations(this.entityClass);
        for (const rel of relations) {
            if (rel.isMany) {
                (doc as any)[rel.propertyName] = [];
            }
        }

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

        const cachedData = await this.cacheManager.get<any[]>(cacheKey);
        if (cachedData) {
            this.logger.debug(`[Cache Hit] Datos obtenidos de memoria para: ${this.sheetName}`);
            return cachedData;
        }

        this.logger.debug(`[Cache Miss] Solicitando filas crudas al DSM para: ${this.sheetName}`);
        let items = await this.dataSource.readFindAll<any>(this.sheetName);

        if (!items) {
            items = [];
        }

        const schema = this.metadata.getSchema(this.entityClass);
        const deleteControlProp = schema.deleteControl;

        if (deleteControlProp && !includeInactive && items.length > 0) {
            items = items.filter(item => !item[deleteControlProp]);
        }

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
                'INSERT' as TypeOp,
                payload,
                rawRowValues
            );
            doc.markAsSaved(-1);
        }));
    }

    private async processUpdates(docs: any[]): Promise<void> {
        if (!docs || docs.length === 0) return;

        await Promise.all(docs.map(async (doc: SheetDocument<T>) => {
            if (doc.version !== undefined && typeof doc.setVersion === 'function') {
                doc.setVersion(doc.version + 1);
            }

            const payload = doc.toJSON();
            const rawRowValues = this.metadata.serialize(doc as unknown as T, this.entityClass);
            const rowIndex = (doc as any)[ROW_INDEX_SYMBOL];

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
                doc[deleteControlProp as keyof SheetDocument<T>] = true as any;
                if (doc.version !== undefined && typeof doc.setVersion === 'function') {
                    doc.setVersion(doc.version + 1);
                }

                const payload = doc.toJSON();
                const rawRowValues = this.metadata.serialize(doc as unknown as T, this.entityClass);

                await this.dataSource.dispatchMutation(
                    this.entityClass,
                    'UPDATE' as TypeOp,
                    payload,
                    { rowIndex, values: rawRowValues }
                );
            } else {
                const payload = doc.toJSON();

                await this.dataSource.dispatchMutation(
                    this.entityClass,
                    'DELETE' as TypeOp,
                    payload,
                    { rowIndex }
                );
            }
        }));
    }

    createAggregation(): AggregationBuilder {
        return this.aggregationFactory.create();
    }
}