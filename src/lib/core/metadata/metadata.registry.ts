import { Injectable } from '@nestjs/common';

import {
    SHEETS_PRIMARY_KEY,
    SHEETS_COLUMN_DETAILS,
    SHEETS_ALL_RELATIONS,
    SHEETS_COLUMN_LIST,
    SHEETS_DELETE_CONTROL,
    SHEETS_RELATIONS_LIST,
    SHEETS_TABLE_NAME,
    SHEETS_VERSION_FIELD,
    SHEETS_VIRTUALS
} from '../../shared/constants/metadata.constants';
import { ColumnOptions } from '../../core/metadata/interfaces';
import { ClassType } from '../../core/types/common.types';

export interface EntitySchema {
    sheetName: string;
    primaryKey: string;
    primaryKeyColumnName: string;
    columns: Record<string, ColumnOptions>;
    columnList: string[];
    deleteControl: string | null;
    versionField: string | null;
    relations: string[];
    virtuals: any[];
}

@Injectable()
export class MetadataRegistry {
    private readonly schemaCache = new Map<Function, EntitySchema>();
    private static readonly registeredEntitiesStore = new Set<ClassType<any>>();

    getSchema(entityClass: ClassType<any>): EntitySchema {
        let schema = this.schemaCache.get(entityClass);
        if (!schema) {
            schema = this.compileSchema(entityClass);
            this.schemaCache.set(entityClass, schema);
        }
        return schema;
    }

    getPrimaryKeyField<T extends object>(entityClass: ClassType<T>): string {
        return this.getSchema(entityClass).primaryKey;
    }

    /** Retorna el nombre físico real de la columna PK (Ej: "ID" u "OBRERO_ID") */
    getPrimaryKeyColumnName<T extends object>(entityClass: ClassType<T>): string {
        return this.getSchema(entityClass).primaryKeyColumnName;
    }

    getColumnDetails(entityClass: ClassType<any>): Record<string, ColumnOptions> {
        return this.getSchema(entityClass).columns;
    }

    getColumnMap(entityClass: ClassType<any>): Record<string, number> {
        const schema = this.getSchema(entityClass);
        const map: Record<string, number> = {};
        schema.columnList.forEach((colName, index) => { map[colName] = index; });
        return map;
    }

    getDeleteControlProperty<T extends object>(entityClass: ClassType<T>): string | null {
        return this.getSchema(entityClass).deleteControl;
    }

    getRelationsList<T extends object>(entityClass: ClassType<T>): string[] {
        return this.getSchema(entityClass).relations;
    }

    getColumnList<T extends object>(entityClass: ClassType<T>): string[] {
        return this.getSchema(entityClass).columnList;
    }

    getVersionField<T extends object>(entityClass: ClassType<T>): string | null {
        return this.getSchema(entityClass).versionField;
    }

    getColumnOptions<T extends object>(entityClass: ClassType<T>, path: string): ColumnOptions | undefined {
        const details = this.getColumnDetails(entityClass);
        if (!path.includes('.')) return details[path];
        return this.resolveDeepMetadata(entityClass, path.split('.'));
    }

    private resolveDeepMetadata(targetClass: ClassType<any>, parts: string[]): ColumnOptions | undefined {
        let currentTarget = targetClass;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const details = this.getColumnDetails(currentTarget);
            if (i === parts.length - 1) return details[part];

            const relOptions = Reflect.getMetadata(SHEETS_ALL_RELATIONS, currentTarget.prototype, part) ||
                Reflect.getMetadata(SHEETS_ALL_RELATIONS, currentTarget, part);

            if (relOptions?.targetEntity) {
                currentTarget = relOptions.targetEntity();
            } else {
                return undefined;
            }
        }
        return undefined;
    }

    getRelationOptions(entityClass: ClassType<any>, relationName: string): any {
        return Reflect.getMetadata(SHEETS_ALL_RELATIONS, entityClass.prototype, relationName) ||
            Reflect.getMetadata(SHEETS_ALL_RELATIONS, entityClass, relationName);
    }

    getEntityBySheetName(sheetName: string): ClassType<any> | undefined {
        const targetSheetName = sheetName.toUpperCase();
        for (const entity of MetadataRegistry.getAllRegisteredEntities()) {
            if (this.getSchema(entity).sheetName === targetSheetName) {
                return entity;
            }
        }
        return undefined;
    }

    // --- Control de Registro Estático de Clases ---
    static register(target: ClassType<any>): void {
        this.registeredEntitiesStore.add(target);
    }

    static getAllRegisteredEntities(): ClassType<any>[] {
        return Array.from(this.registeredEntitiesStore);
    }

    private compileSchema(entityClass: ClassType<any>): EntitySchema {
        const proto = entityClass.prototype;
        const primaryKeyProperty = Reflect.getMetadata(SHEETS_PRIMARY_KEY, entityClass) || 'id';
        const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, entityClass) || {};
        const pkConfig = details[primaryKeyProperty];

        return {
            sheetName: (Reflect.getMetadata(SHEETS_TABLE_NAME, entityClass) || entityClass.name).toUpperCase(),
            primaryKey: primaryKeyProperty,
            primaryKeyColumnName: (pkConfig?.name || primaryKeyProperty).toUpperCase(),
            columns: details,
            columnList: Reflect.getMetadata(SHEETS_COLUMN_LIST, entityClass) || [],
            deleteControl: Reflect.getMetadata(SHEETS_DELETE_CONTROL, entityClass) || null,
            versionField: Reflect.getMetadata(SHEETS_VERSION_FIELD, entityClass) || null,
            relations: Reflect.getMetadata(SHEETS_RELATIONS_LIST, proto) || [],
            virtuals: Reflect.getMetadata(SHEETS_VIRTUALS, entityClass) || []
        };
    }

    getColumnNamesForGas<T extends object>(entityClass: ClassType<T>): string[] {
        const schema = this.getSchema(entityClass);
        // Mapea tus columnas de TS a sus nombres físicos en Sheet
        return schema.columnList.map(prop => schema.columns[prop]?.name || prop);
    }
    getEntityByName(className: string): ClassType<any> | undefined {
        for (const entity of MetadataRegistry.getAllRegisteredEntities()) {
            if (entity.name === className) {
                return entity;
            }
        }
        return undefined;
    }
}