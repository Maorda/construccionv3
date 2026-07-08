import 'reflect-metadata';
import { ClassType, TableOptions } from '../metadata/interfaces';
import { MetadataRegistry } from '../../JoinSheetTabs/metadata.registry';
import { SHEETS_DTO, SHEETS_TABLE_NAME, SHEETS_SPREADSHEET_ID } from '../../shared/constants/constants';

// --- DECORADOR @Table ---
export function Table(options: TableOptions): ClassDecorator;
export function Table(name: string, options: TableOptions): ClassDecorator;
export function Table(nameOrOptions: string | TableOptions, options?: TableOptions): ClassDecorator {
    return (target: Function) => {
        const classConstructor = target as ClassType<any>;

        // 1. Resolución segura de firmas sobrecargadas
        const isNameProvided = typeof nameOrOptions === 'string';
        const name = isNameProvided ? nameOrOptions : undefined;
        const finalOptions = isNameProvided ? options! : (nameOrOptions as TableOptions);

        // 2. Auto-generación de nombre limpiando sufijos comunes y convirtiendo a MAYÚSCULAS
        const finalName = name
            ? name.toUpperCase()
            : `${target.name.replace(/(Entity|Model|Schema|Dto)$/i, '')}S`.toUpperCase();

        Reflect.defineMetadata(SHEETS_TABLE_NAME, finalName, classConstructor);

        // 3. Validación e inyección estricta del DTO
        if (finalOptions?.dto) {
            Reflect.defineMetadata(SHEETS_DTO, finalOptions.dto, classConstructor);
        } else {
            throw new Error(`❌ [ODM Decorator Error] La entidad '${target.name}' requiere un DTO configurado en @Table.`);
        }

        // 🔥 SOLUCIÓN A LA MONOGAMIA: Registro dinámico del Spreadsheet ID
        // Si viene en las opciones, se amarra a este libro específico. 
        // Si no, tu repositorio/gateway usará el ID global por defecto.
        if (finalOptions?.spreadsheetId) {
            Reflect.defineMetadata(SHEETS_SPREADSHEET_ID, finalOptions.spreadsheetId, classConstructor);
        }

        // 4. Registro instantáneo en el Symbol Global
        MetadataRegistry.register(classConstructor);
    };
}