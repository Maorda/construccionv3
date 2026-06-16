import { Inject } from '@nestjs/common';
import { SheetDocument } from '../wrapper/sheet-document';
import { SheetsRepository } from '../repository/sheets.repository';
import { ROW_INDEX_SYMBOL } from '../../shared/constants/constants';
import { ClassType } from '../types/common.types';


export const InjectModel = (entity: Function) => Inject(`${entity.name}Model`);

export interface QueryOptions<T = any> {
    projection?: Projection<T>;
    limit?: number;
    offset?: number;
    sort?: { field: string; order: 'ASC' | 'DESC' };
    includeInactive?: boolean; // Control de Soft Delete
    skip?: number;
    forceRefresh?: boolean;
    customConstructor?: ConstructorSignature<T, any>;
    lean?: boolean;
}

export type ConstructorSignature<T, U> = new (
    data: T,
    repo: any, // Usamos any aquí para romper la dependencia circular
    isNew: boolean,
    ...args: any[]
) => U;

export type Projection<T = any> = {
    [P in keyof T]?: boolean | number;
} | Record<string, any>;
export type FilterQuery<T = any> = {
    // 1. Filtros estándar (acceso a propiedades de T)
    [P in keyof T]?: FieldFilter<T[P]>;
} & {
    // 2. Operadores Lógicos (que no son campos de T, pero son permitidos)
    $or?: FilterQuery<T>[];
    $and?: FilterQuery<T>[];
    $nor?: FilterQuery<T>[];

    // 3. (Opcional) Si tu motor de consultas soporta flags globales o metadatos en el query
    // $comment?: string;
    // $hint?: any;
} & {
    // Solo si es estrictamente necesario, y con una advertencia
    [key: string]: any;
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
export type Model<T extends object> = {
    new(data?: Partial<T>): T & SheetDocument<T>;
    save(data: Partial<T>): Promise<T & SheetDocument<T>>;
    find(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<(T & SheetDocument<T>)[]>;
    findOne(filter?: FilterQuery<T>, options?: QueryOptions<T>): Promise<(T & SheetDocument<T>) | null>;
    findOneAndUpdate(filter: FilterQuery<T>, update: any, options?: any): Promise<(T & SheetDocument<T>) | null>;
    aggregate<R = any>(pipeline: any[]): Promise<R[]>;
};

// Se añade RelationEngine como dependencia opcional para soportar el .populate()
export function createModel<T extends object>(
    entityClass: ClassType<T>,
    repo: SheetsRepository<T>,

): Model<T> {
    // 1. Definimos la clase que servirá de contenedor (instancias)
    class ModelClass {
        constructor(data: Partial<T> = {}) {
            const _data = { ...data };
            const _modifiedPaths = new Set<string>();
            let _isNew = (_data as any)[ROW_INDEX_SYMBOL] === undefined;
            let _version = (_data as any).version || 0;

            const instance = Object.assign(Object.create(entityClass.prototype), _data);

            const proxy = new Proxy(instance, {
                get(target, prop, receiver) {
                    if (prop === '_data') return _data;
                    if (prop === '_isNew') return _isNew;
                    return Reflect.get(target, prop, receiver);
                },
                set(target, prop, value, receiver) {
                    if (target[prop] !== value) {
                        _modifiedPaths.add(prop as string);
                        _data[prop as keyof T] = value;
                    }
                    return Reflect.set(target, prop, value, receiver);
                }
            });

            // Definimos el método save en la instancia (capacidad Active Record)
            Object.defineProperty(proxy, 'save', {
                value: async function () {
                    const saved = await repo.save(proxy as any);
                    Object.assign(_data, saved);
                    return proxy;
                },
                enumerable: false
            });

            return proxy;
        }

        // 2. Implementamos los métodos estáticos del contrato Model<T>
        static async save(data: Partial<T>): Promise<T & SheetDocument<T>> {
            const instance = new ModelClass(data);
            return (instance as any).save();
        }

        static async find(filter?: any, options?: any) {
            return await repo.find(filter, options);
        }

        static async findOne(filter?: any, options?: any) {
            return await repo.findOne(filter, options);
        }

        static async findOneAndUpdate(filter: any, update: any, options?: any) {
            return await repo.findOneAndUpdate(filter, update, options);
        }

        static async aggregate<R = any>(pipeline: any[]): Promise<R[]> {
            return await repo.aggregate(pipeline);
        }
    }

    // Retornamos como Model<T> para que TS valide el contrato
    return ModelClass as unknown as Model<T>;
}