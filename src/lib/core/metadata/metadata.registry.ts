// src/lib/services/metadata-registry.service.ts
import { Injectable, Logger } from '@nestjs/common';
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
} from '../../shared/constants/constants';
import { ColumnOptions, ReferenceOptions, SubCollectionOptions } from '../../core/metadata/interfaces';
import { ClassType } from '../../core/types/common.types';

// 🔥 UNIÓN DISCRIMINADA: Para garantizar type-safety absoluto en el motor de persistencia
export type CompiledRelation =
    | {
        propertyName: string;
        isMany: false;
        type: 'reference';
        targetEntity: () => ClassType<any>;
        joinColumn: string;
        required: boolean;
        onDelete: 'CASCADE' | 'SET_NULL' | 'RESTRICT';
        rawOptions: ReferenceOptions; // Guardado para trazabilidad
    }
    | {
        propertyName: string;
        isMany: true;
        type: 'subcollection';
        targetEntity: () => ClassType<any>;
        joinColumn?: string;
        localField?: string;
        cascadeDelete: boolean;
        onDelete: 'CASCADE' | 'SET_NULL' | 'RESTRICT';
        rawOptions: SubCollectionOptions; // Guardado para trazabilidad
    };

export interface EntitySchema {
    sheetName: string;
    primaryKey: string;
    primaryKeyColumnName: string;
    columns: Record<string, ColumnOptions>;
    columnList: string[];
    deleteControl: string | null;
    versionField: string | null;
    relations: Record<string, CompiledRelation>; // 🔥 Cambiado de string[] a Record para acceso O(1)
    virtuals: any[];
}

@Injectable()
export class MetadataRegistry {
    private readonly logger = new Logger(MetadataRegistry.name);
    private readonly schemaCache = new Map<Function, EntitySchema>();
    private static readonly registeredEntitiesStore = new Set<ClassType<any>>();

    /**
     * Obtiene o compila el esquema de la entidad de forma segura
     */
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

    // 🔥 REFACTOR: Devuelve las llaves de las relaciones para mantener compatibilidad
    getRelationsList<T extends object>(entityClass: ClassType<T>): string[] {
        return Object.keys(this.getSchema(entityClass).relations);
    }

    // 🔥 NUEVO: Devuelve los objetos de relación completos listos para el PersistenceEngine
    getCompiledRelations<T extends object>(entityClass: ClassType<T>): CompiledRelation[] {
        return Object.values(this.getSchema(entityClass).relations);
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

            const schema = this.getSchema(currentTarget);
            const relation = schema.relations[part];

            if (relation?.targetEntity) {
                currentTarget = relation.targetEntity();
            } else {
                return undefined;
            }
        }
        return undefined;
    }

    // 🔥 OPTIMIZACIÓN: Ya no consulta Reflect en caliente, va directo a la caché compilada
    getRelationOptions(entityClass: ClassType<any>, relationName: string): CompiledRelation | undefined {
        return this.getSchema(entityClass).relations[relationName];
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

    static register(target: ClassType<any>): void {
        this.registeredEntitiesStore.add(target);
    }

    static getAllRegisteredEntities(): ClassType<any>[] {
        return Array.from(this.registeredEntitiesStore);
    }

    /**
     * Compilador robusto de esquemas con validaciones Fail-Fast
     */
    /**
     * El compilador ahora normaliza basándose en el tipo de relación
     */
    private compileSchema(entityClass: ClassType<any>): EntitySchema {
        const proto = entityClass.prototype;
        const primaryKeyProperty = Reflect.getMetadata(SHEETS_PRIMARY_KEY, entityClass) || 'id';
        const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, entityClass) || {};
        const pkConfig = details[primaryKeyProperty];

        const relationProperties: string[] = Reflect.getMetadata(SHEETS_RELATIONS_LIST, proto) || [];
        const compiledRelations: Record<string, CompiledRelation> = {};

        for (const prop of relationProperties) {
            const rawRel = Reflect.getMetadata(SHEETS_ALL_RELATIONS, proto, prop) ||
                Reflect.getMetadata(SHEETS_ALL_RELATIONS, entityClass, prop);

            if (!rawRel) continue;

            // 🛠️ Mapeo condicional estricto según la estructura de tus decoradores
            if (rawRel.isMany) {
                // Es un SubCollection
                const subOptions: SubCollectionOptions = rawRel.options || { cascadeDelete: false };
                compiledRelations[prop] = {
                    propertyName: prop,
                    isMany: true,
                    type: 'subcollection',
                    targetEntity: rawRel.targetEntity,
                    joinColumn: subOptions.joinColumn,
                    localField: subOptions.localField,
                    cascadeDelete: subOptions.cascadeDelete,
                    onDelete: subOptions.onDelete || 'RESTRICT',
                    rawOptions: subOptions
                };
            } else {
                // Es un Reference
                compiledRelations[prop] = {
                    propertyName: prop,
                    isMany: false,
                    type: 'reference',
                    targetEntity: rawRel.targetEntity,
                    joinColumn: rawRel.joinColumn,
                    required: rawRel.required ?? false,
                    onDelete: rawRel.onDelete || 'RESTRICT',
                    rawOptions: {
                        joinColumn: rawRel.joinColumn,
                        required: rawRel.required,
                        onDelete: rawRel.onDelete
                    }
                };
            }
        }

        const sheetNameAttr = Reflect.getMetadata(SHEETS_TABLE_NAME, entityClass);
        const sheetName = (sheetNameAttr || entityClass.name).toUpperCase();

        return {
            sheetName,
            primaryKey: primaryKeyProperty,
            primaryKeyColumnName: (pkConfig?.name || primaryKeyProperty).toUpperCase(),
            columns: details,
            columnList: Reflect.getMetadata(SHEETS_COLUMN_LIST, entityClass) || [],
            deleteControl: Reflect.getMetadata(SHEETS_DELETE_CONTROL, entityClass) || null,
            versionField: Reflect.getMetadata(SHEETS_VERSION_FIELD, entityClass) || null,
            relations: compiledRelations,
            virtuals: Reflect.getMetadata(SHEETS_VIRTUALS, entityClass) || []
        };
    }

    getColumnNamesForGas<T extends object>(entityClass: ClassType<T>): string[] {
        const schema = this.getSchema(entityClass);
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