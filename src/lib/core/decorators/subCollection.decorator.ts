import 'reflect-metadata';
import { ClassType } from '../types/common.types';
import { SHEETS_ALL_RELATIONS, SHEETS_RELATIONS_LIST } from '../../shared/constants/constants';
import { SubCollectionOptions } from '../metadata/interfaces';

export function SubCollection(arg: (() => ClassType<any>) | ClassType<any>, options: SubCollectionOptions): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        const propertyName = propertyKey.toString();

        // 1. Resolución diferida para evitar dependencias circulares
        const targetEntityFn = typeof arg === 'function' && !arg.prototype
            ? (arg as () => ClassType<any>)
            : () => arg as ClassType<any>;

        // 🌟 ADIÓS A LA INFERENCIA MÁGICA
        // Al exigir 'joinColumn' desde la interfaz de Typescript, 
        // obligas al desarrollador a conocer y mapear explícitamente su base de datos.
        const explicitJoinColumn = options.joinColumn;

        // 2. Construcción del contrato de la relación
        const relationConfig = {
            type: 'subcollection',      // Identificador semántico para el motor
            targetEntity: targetEntityFn,
            isMany: true,
            propertyName,
            joinColumn: explicitJoinColumn, // 👈 Se inyecta directamente el valor obligatorio
            cascadeDelete: options.cascadeDelete ?? false, // Fallback seguro
            onDelete: options.onDelete || 'CASCADE'
        };

        // 3. Registro seguro de la lista de propiedades a hidratar
        const existingList = Reflect.getOwnMetadata(SHEETS_RELATIONS_LIST, target) || [];
        const newList = Array.from(new Set([...existingList, propertyName]));
        Reflect.defineMetadata(SHEETS_RELATIONS_LIST, newList, target);

        // 4. Guardado del contrato detallado
        Reflect.defineMetadata(SHEETS_ALL_RELATIONS, relationConfig, target, propertyName);
    };
};