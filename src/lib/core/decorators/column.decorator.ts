import 'reflect-metadata';
import { SHEETS_COLUMN_DETAILS, SHEETS_COLUMN_LIST, SHEETS_DELETE_CONTROL } from '../../shared/constants/constants'
import { ColumnOptions } from '../../core/metadata/interfaces';
// --- DECORADOR @Column ---
export function Column(options: ColumnOptions = {}): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        // 🔥 BLINDAJE: Detecta si el decorador se usó en una propiedad estática o de instancia
        const classConstructor = typeof target === 'function' ? target : target.constructor;
        const propString = propertyKey.toString();

        let columnsList = Reflect.getOwnMetadata(SHEETS_COLUMN_LIST, classConstructor);
        if (!columnsList) {
            columnsList = [...(Reflect.getMetadata(SHEETS_COLUMN_LIST, classConstructor) || [])];
        }

        if (!columnsList.includes(propString)) {
            columnsList.push(propString);
            Reflect.defineMetadata(SHEETS_COLUMN_LIST, columnsList, classConstructor);
        }

        const config: ColumnOptions = {
            name: options.name || propString,
            type: options.type || 'string',
            required: options.required ?? false,
            default: options.default ?? null,
            isDeleteControl: options.isDeleteControl || false,
            isAutoIncrement: options.isAutoIncrement || (options.generated === 'increment'),
            generated: options.generated,
            validation: options.validation,
            index: options.index || false

        };

        let details = Reflect.getOwnMetadata(SHEETS_COLUMN_DETAILS, classConstructor);
        if (!details) {
            details = { ...(Reflect.getMetadata(SHEETS_COLUMN_DETAILS, classConstructor) || {}) };
        }

        details[propString] = config;
        Reflect.defineMetadata(SHEETS_COLUMN_DETAILS, details, classConstructor);

        if (config.isDeleteControl) {
            Reflect.defineMetadata(SHEETS_DELETE_CONTROL, propString, classConstructor);
        }
    };
}