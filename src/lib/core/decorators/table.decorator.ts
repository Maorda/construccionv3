import 'reflect-metadata';
import { ClassType, TableOptions } from '../metadata/interfaces';

import { MetadataRegistry } from '../metadata/metadata.registry';
import { SHEETS_DTO, SHEETS_TABLE_NAME } from '../../shared/constants/constants';
// --- DECORADOR @Table ---
export function Table(options: TableOptions): ClassDecorator;
export function Table(name: string, options: TableOptions): ClassDecorator;
export function Table(nameOrOptions: string | TableOptions, options?: TableOptions): ClassDecorator {
    return (target: Function) => {
        const classConstructor = target as ClassType<any>;

        // 🔥 BLINDAJE: Resolución segura de firmas sobrecargadas
        const isNameProvided = typeof nameOrOptions === 'string';
        const name = isNameProvided ? nameOrOptions : undefined;
        const finalOptions = isNameProvided ? options! : (nameOrOptions as TableOptions);

        // Auto-generación de nombre limpiando sufijos comunes y pluralizando
        const finalName = name
            ? name.toUpperCase()
            : `${target.name.replace(/(Entity|Model|Schema|Dto)$/i, '')}S`.toUpperCase();

        Reflect.defineMetadata(SHEETS_TABLE_NAME, finalName, classConstructor);

        if (finalOptions?.dto) {
            Reflect.defineMetadata(SHEETS_DTO, finalOptions.dto, classConstructor);
        } else {
            throw new Error(`❌ [ODM Decorator Error] La entidad '${target.name}' requiere un DTO configurado en @Table.`);
        }

        // Registro instantáneo en el Symbol Global
        MetadataRegistry.register(classConstructor);
    };
}