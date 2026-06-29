import { Inject, Logger } from '@nestjs/common';
import { SheetDocument } from '../wrapper/sheet-document';
import { SheetsRepository } from '../repository/sheets.repository';
import { ROW_INDEX_SYMBOL, SHEETS_COLUMN_DETAILS, SHEETS_RELATIONS_LIST } from '../../shared/constants/constants';
import { ClassType } from '../types/common.types';

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
};

// ============================================================================
// FÁBRICA DEL MODELO (Model Factory)
// ============================================================================

export function createModel<T extends object>(
    entityClass: ClassType<T>,
    repo: SheetsRepository<T>,
): Model<T> {

    class DocumentModel {
        // Tipos de uso interno. No se inicializan aquí para evitar que sean enumerables
        declare private __isNew: boolean;
        declare private __modifiedPaths: Set<string>;
        private readonly logger = new Logger(DocumentModel.name);



        constructor(data: Partial<T> = {}) {
            this.logger.debug(`[FLOW-2] Datos recibidos en Constructor: ${Object.keys(data).length} keys. Keys: ${Object.keys(data)}`);
            // 1. Configuramos estado interno
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

            // 2. Asignamos los datos

            Object.assign(this, data);
            this.logger.debug(`[FLOW-3] Instancia post-asignación (Nombre): ${this['nombre'] || 'UNDEFINED'}`);

            // --- INSTRUMENTACIÓN ---
            console.log(`🔍 [DocumentModel] Instancia creada con keys:`, Object.keys(this));
            console.log(`🔍 [DocumentModel] Datos asignados (id):`, (this as any).id);
            console.log(`🔍 [DocumentModel] Datos asignados (nombre):`, (this as any).nombre);
            // -----------------------

            return new Proxy(this, {
                set(target, prop, value, receiver) {
                    if (target[prop as keyof DocumentModel] !== value) {
                        target.__modifiedPaths.add(prop as string);
                    }
                    return Reflect.set(target, prop, value, receiver);
                }
            });

        }

        toJSON() {
            const plain: any = {};
            const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, entityClass.prototype) || {};
            const descriptors = Object.getOwnPropertyDescriptors(entityClass.prototype);

            // 1. Columnas base (Nombres limpios de TypeScript)
            for (const col of Object.keys(details)) {
                plain[col] = (this as any)[col] !== undefined ? (this as any)[col] : null;
            }

            // 2. Virtuals / Getters definidos en la entidad
            for (const key of Object.keys(descriptors)) {
                if (descriptors[key].get && key !== 'constructor') {
                    plain[key] = (this as any)[key];
                }
            }

            // 3. Relaciones (Ej: array de adelantos)
            const relations = Reflect.getOwnMetadata(SHEETS_RELATIONS_LIST, entityClass.prototype) || [];
            for (const rel of relations) {
                if ((this as any)[rel] !== undefined) plain[rel] = (this as any)[rel];
            }

            return plain;
        }

        // ====================================================================
        // 📝 SERIALIZACIÓN PARA BASE DE DATOS (Google Sheets Outbox)
        // ====================================================================
        toSheetRow() {
            const plain: any = {};
            const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, entityClass.prototype) || {};

            // Mapeo inverso: De llaves TS a Cabeceras reales (con asteriscos)
            for (const key of Object.keys(details)) {
                const config = details[key];
                const dbColumnName = config.name || key;
                plain[dbColumnName] = (this as any)[key] !== undefined ? (this as any)[key] : null;
            }

            // Inyectar el número de fila para que Sheets sepa qué actualizar
            if (this.rowNumber !== undefined) {
                plain.__row = this.rowNumber;
            }

            return plain;
        }

        // ====================================================================
        // MÉTODOS DE INSTANCIA (Capacidad Active Record)
        // Optimizados en el prototipo para no consumir memoria redundante
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
        }

        // ====================================================================
        // MÉTODOS ESTÁTICOS (Delegación al Repositorio)
        // Ahora con tipado fuerte inferido desde T
        // ====================================================================

        static async save(data: Partial<T>): Promise<T & SheetDocument<T>> {
            const instance = new DocumentModel(data);
            return instance.save();
        }

        static async find(filter?: FilterQuery<T>, options?: QueryOptions<T>) {
            console.log("document model find", repo.find(filter, options));
            return repo.find(filter, options);
        }

        static async findOne(filter?: FilterQuery<T>, options?: QueryOptions<T>) {
            console.log("document model find one", repo.findOne(filter, options));
            return repo.findOne(filter, options);
        }

        static async findOneAndUpdate(filter: FilterQuery<T>, update: UpdateQuery<T>, options?: FindOneAndUpdateOptions<T>) {
            return repo.findOneAndUpdate(filter, update, options);
        }

        static async aggregate<R = any>(pipeline: any[]): Promise<R[]> {
            return repo.aggregate<R>(pipeline);
        }
    }

    // 🚀 MAGIA DE HERENCIA: Vinculamos el prototipo de DocumentModel al de la Entidad.
    // Esto permite que métodos customizados en tu `ObreroEntity` o `AdelantoEntity`
    // sigan funcionando perfectamente en los resultados de las consultas.
    Object.setPrototypeOf(DocumentModel.prototype, entityClass.prototype);

    return DocumentModel as unknown as Model<T>;
}