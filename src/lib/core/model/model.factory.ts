import { Inject, Logger } from '@nestjs/common';
import { SheetDocument } from '../wrapper/sheet-document';
import { SheetsRepository } from '../repository/sheets.repository';
import { ROW_INDEX_SYMBOL, SHEETS_COLUMN_DETAILS, SHEETS_PRIMARY_KEY, SHEETS_RELATIONS_LIST } from '../../shared/constants/constants';
import { ClassType } from '../types/common.types';
import { MetadataRegistry } from '../metadata/metadata.registry';
import { AggregationBuilder } from '../../stages/aggregation.builder';
import { IdFactory } from '../../shared/id.generator';
import { DateTransformer } from '../../stages/transform.operators';

// ============================================================================
// TIPOS Y OPCIONES (Tipado Estricto Mongoose-like)
// ============================================================================

export type UpdateQuery<T> = {
    [P in keyof T]?: T[P];
} & {
    $set?: Partial<T>;
    $inc?: { [P in keyof T]?: number };
    $push?: { [key: string]: any };
    $pull?: { [key: string]: any };
    $unset?: { [P in keyof T]?: boolean | number | string };
};

export interface FindOneAndUpdateOptions<T extends object, U = any> extends QueryOptions<T> {
    upsert?: boolean;
    new?: boolean;
    customConstructor?: ConstructorSignature<T, U>;
}

export const InjectModel = (entity: Function) => Inject(`${entity.name}Model`);

export interface PopulateOptions {
    path: string;
    // Futuras mejoras: select?: string[], match?: any, limit?: number
}

export interface QueryOptions<T = any> {
    populate?: string | string[] | PopulateOptions | PopulateOptions[];
    projection?: Projection<T>;
    limit?: number;
    offset?: number;
    sort?: { field: string; order: 'ASC' | 'DESC' };
    includeInactive?: boolean;
    skip?: number;
    forceRefresh?: boolean;
    customConstructor?: ConstructorSignature<T, any>;
    lean?: boolean;
}

export type ConstructorSignature<T, U> = new (
    data: T,
    repo: any,
    isNew: boolean,
    ...args: any[]
) => U;

export type Projection<T = any> = {
    [P in keyof T]?: boolean | number;
} | Record<string, any>;

export type FilterQuery<T = any> = {
    [P in keyof T]?: FieldFilter<T[P]>;
} & {
    $or?: FilterQuery<T>[];
    $and?: FilterQuery<T>[];
    $nor?: FilterQuery<T>[];
} & {
    [key: string]: any; // Válvula de escape por si el engine soporta queries custom
};

export type FieldFilter<T> = T | ComparisonOperators<T>;

export type ComparisonOperators<T> = {
    $eq?: T;
    $gt?: T;
    $gte?: T;
    $lt?: T;
    $lte?: T;
    $in?: T[];
    $nin?: T[];
    $ne?: T;
    $exists?: boolean;
    $regex?: string;
};

// ============================================================================
// INTERFAZ DEL MODELO (Active Record + Data Mapper)
// ============================================================================

export type Model<T extends object> = {
    new(data?: Partial<T>): T & SheetDocument<T>;
    save(data: Partial<T>): Promise<T & SheetDocument<T>>;
    find(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<(T & SheetDocument<T>)[]>;
    findOne(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<(T & SheetDocument<T>) | null>;
    findOneAndUpdate(filter: FilterQuery<T>, update: UpdateQuery<T>, options?: FindOneAndUpdateOptions<T>): Promise<(T & SheetDocument<T>) | null>;
    aggregate<R = any>(pipeline: any[]): Promise<R[]>;
    aggregate(): AggregationBuilder;
};

// ============================================================================
// FÁBRICA DEL MODELO (Model Factory)
// ============================================================================

export function createModel<T extends object>(
    entityClass: ClassType<T>,
    repo: SheetsRepository<T>,
): Model<T> {

    class DocumentModel {
        declare private __isNew: boolean;
        declare private __modifiedPaths: Set<string>;
        private readonly logger: Logger;

        constructor(data: Partial<T> = {}) {
            Object.defineProperty(this, 'logger', {
                value: new Logger(`Model<${entityClass.name}>`),
                writable: false,
                enumerable: false,
            });

            this.logger.debug(`[FLOW-2] Datos recibidos en Constructor: ${Object.keys(data).length} keys.`);

            Object.assign(this, data);
            const primaryKeyProperty = (Reflect.getMetadata(SHEETS_PRIMARY_KEY, entityClass) || 'id') as string;

            if (!(this as any)[primaryKeyProperty]) {
                const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, entityClass) || {};
                const pkConfig = details[primaryKeyProperty];

                if (pkConfig?.generated === 'short-id') {
                    (this as any)[primaryKeyProperty] = IdFactory.createShort();
                    this.logger.debug(`[FLOW-ID] Generado short-id automático en constructor: ${(this as any)[primaryKeyProperty]}`);
                } else if (pkConfig?.generated === 'uuid' || pkConfig?.generated === 'increment') {
                    (this as any)[primaryKeyProperty] = IdFactory.createUUID();
                    this.logger.debug(`[FLOW-ID] Generado UUID automático en constructor: ${(this as any)[primaryKeyProperty]}`);
                }
            }

            Object.defineProperty(this, '__isNew', {
                value: data[ROW_INDEX_SYMBOL as keyof Partial<T>] === undefined,
                writable: true,
                enumerable: false,
            });
            Object.defineProperty(this, '__modifiedPaths', {
                value: new Set<string>(),
                writable: true,
                enumerable: false,
            });



            return new Proxy(this, {
                set(target, prop, value, receiver) {
                    if (target[prop as keyof DocumentModel] !== value) {
                        target.__modifiedPaths.add(prop as string);
                    }
                    return Reflect.set(target, prop, value, receiver);
                }
            });
        }

        // ====================================================================
        // 📝 SERIALIZACIÓN BLINDADA CORREGIDA Y AUDITADA
        // ====================================================================
        toJSON() {
            const plain: Record<string, any> = {};

            // 💡 SOLUCIÓN: Leemos directamente desde 'entityClass' (Constructor), no desde el prototype
            const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, entityClass) || {};
            const descriptors = Object.getOwnPropertyDescriptors(entityClass.prototype);
            const metadataKeys = Object.keys(details);

            this.logger.debug(`[FLOW-METADATA] Inspeccionando @Column en [${entityClass.name}]. Encontradas: [${metadataKeys.join(', ')}]`);

            // 🟢 INTENTO 1: Vía Metadatos de Decoradores (@Column)
            if (metadataKeys.length > 0) {
                for (const col of metadataKeys) {
                    plain[col] = (this as any)[col] !== undefined ? (this as any)[col] : null;
                }
            } else {
                // 🛡️ FALLBACK DE SEGURIDAD
                this.logger.warn(`⚠️ [FLOW-SERIALIZE] No se hallaron metadatos @Column en [${entityClass.name}]. Usando fallback de seguridad por reflexión superficial.`);
                for (const key of Object.keys(this)) {
                    if (typeof (this as any)[key] !== 'function' && !key.startsWith('__')) {
                        plain[key] = (this as any)[key];
                    }
                }
            }

            for (const key of metadataKeys) {
                let val = (this as any)[key];
                // 🚀 TRANSFORMACIÓN DE LECTURA: Convertimos lo que viene de Sheets a formato sistema
                if (details[key]?.type === 'date' && val) {
                    val = DateTransformer.fromSheet(val);
                }
                plain[key] = val !== undefined ? val : null;
            }

            // 🔵 VIRTUALS: Getters definidos en la entidad
            let virtualsCount = 0;
            for (const key of Object.keys(descriptors)) {
                if (descriptors[key].get && key !== 'constructor') {
                    plain[key] = (this as any)[key];
                    virtualsCount++;
                }
            }
            if (virtualsCount > 0) {
                this.logger.debug(`[FLOW-SERIALIZE] Mapeados ${virtualsCount} Virtual Getters en [${entityClass.name}].`);
            }

            // 🟣 RELACIONES: Mapeamos el Target del constructor también si aplica
            const relations = Reflect.getOwnMetadata(SHEETS_RELATIONS_LIST, entityClass) ||
                Reflect.getOwnMetadata(SHEETS_RELATIONS_LIST, entityClass.prototype) || [];

            for (const rel of relations) {
                if ((this as any)[rel] !== undefined) {
                    plain[rel] = (this as any)[rel];
                }
            }

            return plain;
        }

        toSheetRow() {
            const plain: Record<string, any> = {};
            const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, entityClass) || {};
            const metadataKeys = Object.keys(details);

            for (const key of metadataKeys) {
                const dbColumnName = MetadataRegistry.prototype.getDatabaseColumnName(entityClass, key);
                let val = (this as any)[key];

                // 🚀 TRANSFORMACIÓN DE ESCRITURA: Convertimos el formato sistema a DD/MM/YY
                if (details[key]?.type === 'date' && val) {
                    val = DateTransformer.toSheet(val);
                }

                plain[dbColumnName] = val !== undefined ? val : null;
            }

            if (this.rowNumber !== undefined) plain.__row = this.rowNumber;
            return plain;
        }

        // ====================================================================
        // MÉTODOS DE INSTANCIA
        // ====================================================================
        async save(): Promise<T & SheetDocument<T>> {
            const saved = await repo.save(this as any);
            Object.assign(this, saved);
            return this as unknown as T & SheetDocument<T>;
        }

        async remove(): Promise<void> {
            await repo.delete(this as any);
        }

        getPrimaryKeyValue(key: string): any {
            return (this as any)[key];
        }

        get rowNumber(): number | undefined {
            return (this as any)[ROW_INDEX_SYMBOL];
        }

        markAsSaved(rowNum: number): void {
            this.__isNew = false;
            (this as any)[ROW_INDEX_SYMBOL] = rowNum;
            this.logger.debug(`[FLOW-WAL] Documento marcado como guardado en Sheets. Fila asignada: ${rowNum}`);
        }

        // ====================================================================
        // MÉTODOS ESTÁTICOS
        // ====================================================================
        static async save(data: Partial<T>): Promise<T & SheetDocument<T>> {
            const instance = new DocumentModel(data);
            return instance.save();
        }

        static async find(filter?: FilterQuery<T>, options?: QueryOptions<T>) {
            return repo.find(filter, options);
        }

        static async findOne(filter?: FilterQuery<T>, options?: QueryOptions<T>) {
            return repo.findOne(filter, options);
        }

        static async findOneAndUpdate(filter: FilterQuery<T>, update: UpdateQuery<T>, options?: FindOneAndUpdateOptions<T>) {
            return repo.findOneAndUpdate(filter, update, options);
        }

        static aggregate(): AggregationBuilder {
            return repo.createAggregation();
        }
    }

    Object.setPrototypeOf(DocumentModel.prototype, entityClass.prototype);

    // ✨ CONEXIÓN CRÍTICA: Le decimos al repositorio que use este envoltorio al hidratar
    repo.bindModel(DocumentModel);

    return DocumentModel as unknown as Model<T>;
}