/**
 * METADATA CONSTANTS - UNIFICADAS
 * Solo una llave por cada propósito para garantizar un registro de metadatos limpio y coherente.
 */

// 1. NIVEL DE TABLA (CLASE)
export const SHEETS_TABLE_NAME = Symbol('sheets:table_name');

// 2. NIVEL DE COLUMNAS (LISTA Y DETALLES)
// La lista ordenada de nombres de propiedades en TS (Array de strings)
export const SHEETS_COLUMN_LIST = Symbol('sheets:column_list');
// La configuración individual de cada propiedad decorada con @Column
export const TABLE_COLUMN_KEY = Symbol('sheets:table_column');
// El mapa completo consolidado de detalles (Record<string, ColumnOptions>)
export const SHEETS_COLUMN_DETAILS = Symbol('sheets:column_details');

// 3. IDENTIDAD Y ESTADO
export const SHEETS_PRIMARY_KEY = Symbol('sheets:primary_key');
export const SHEETS_DELETE_CONTROL = Symbol('sheets:delete_control');

// 4. NIVEL DE RELACIONES
export const SHEETS_RELATIONS_LIST = Symbol('sheets:relations_list');
export const SHEETS_ALL_RELATIONS = Symbol('sheets:all_relations');

// 5. OTROS CONSTANTES
export const SHEETS_VIRTUALS = Symbol('sheets:virtuals');
export const SHEETS_SUB_COLLECTIONS = Symbol('sheets:sub_collections');
export const SHEETS_REPOSITORY_MARKER = Symbol.for('__isSheetsRepository');
export const SHEETS_DTO = Symbol('sheets:dto');
export const ROW_INDEX_SYMBOL = Symbol('__row');
export const SHEETS_VIRTUAL_COLUMNS = Symbol('SHEETS_VIRTUAL_COLUMNS');
export const SHEETS_VERSION_FIELD = Symbol('sheets:version_field');
export const SHEETS_HOOKS = Symbol('sheets:hooks');

export enum HookType {
    PRE_SAVE = 'preSave',
    POST_SAVE = 'postSave'
}