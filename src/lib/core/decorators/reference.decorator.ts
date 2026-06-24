import 'reflect-metadata';
import { ClassType } from '../types/common.types';
import { ReferenceOptions } from '../metadata/interfaces';
import { SHEETS_ALL_RELATIONS, SHEETS_RELATIONS_LIST } from '../../shared/constants/constants';

export function Reference(arg: (() => ClassType<any>) | ClassType<any>, options?: ReferenceOptions): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        const propertyName = propertyKey.toString();

        const targetEntityFn = typeof arg === 'function' && !arg.prototype
            ? (arg as () => ClassType<any>)
            : () => arg as ClassType<any>;

        // 🌟 INFERENCIA INVERSA
        // Si no se especifica, inferimos que la columna en la HOJA ACTUAL 
        // se llama igual que la propiedad + 'Id'.
        // Ejemplo: Si la propiedad es 'material', buscamos la columna 'materialId'.
        const inferredJoinColumn = options?.joinColumn || `${propertyName}Id`;

        const relationConfig = {
            type: 'reference',          // 👈 Distintivo clave para el PopulateEngine
            targetEntity: targetEntityFn,
            isMany: false,              // 👈 Una referencia apunta a UN solo documento
            propertyName,
            joinColumn: inferredJoinColumn,

        };

        // Registro en la lista de relaciones (igual que SubCollection)
        const existingList = Reflect.getOwnMetadata(SHEETS_RELATIONS_LIST, target) || [];
        const newList = Array.from(new Set([...existingList, propertyName]));
        Reflect.defineMetadata(SHEETS_RELATIONS_LIST, newList, target);

        Reflect.defineMetadata(SHEETS_ALL_RELATIONS, relationConfig, target, propertyName);
    };
};