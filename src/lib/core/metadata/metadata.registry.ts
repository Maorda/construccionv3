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

export type CompiledRelation =
    | {
        propertyName: string;
        isMany: false;
        type: 'reference';
        targetEntity: () => ClassType<any>;
        joinColumn: string;
        required: boolean;
        onDelete: 'CASCADE' | 'SET_NULL' | 'RESTRICT';
        rawOptions: ReferenceOptions;
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
        rawOptions: SubCollectionOptions;
    };

export interface EntitySchema {
    sheetName: string;
    primaryKey: string;
    primaryKeyColumnName: string;
    columns: Record<string, ColumnOptions>;
    columnList: string[];
    deleteControl: string | null;
    versionField: string | null;
    relations: Record<string, CompiledRelation>;
    virtuals: any[];
}

// 🔥 OPTIMIZACIÓN CRÍTICA: Símbolo global inmutable para prevenir el "Asesino Silencioso" 
// de múltiples instancias de la clase en librerías empaquetadas.
const ODM_GLOBAL_REGISTRY_KEY = Symbol.for('sheetOdm.global_metadata_store');
if (!globalThis[ODM_GLOBAL_REGISTRY_KEY]) {
    globalThis[ODM_GLOBAL_REGISTRY_KEY] = new Set<ClassType<any>>();
}

@Injectable()
export class MetadataRegistry {
    private static entities: Set<Function> = new Set();
    private readonly logger = new Logger(MetadataRegistry.name);

    // Cachés a nivel de instancia
    private readonly schemaCache = new Map<Function, EntitySchema>();

    // 🔥 OPTIMIZACIÓN: Índices O(1) para búsquedas ultrarrápidas
    private readonly nameIndex = new Map<string, ClassType<any>>();
    private readonly sheetIndex = new Map<string, ClassType<any>>();

    static register(target: ClassType<any>): void {
        const store = globalThis[ODM_GLOBAL_REGISTRY_KEY] as Set<ClassType<any>>;
        store.add(target);
        console.log(`🔍 [MetadataRegistry] Entidad registrada: ${target.name}. Total: ${this.entities.size}`);
    }

    static getAllRegisteredEntities(): ClassType<any>[] {
        const store = globalThis[ODM_GLOBAL_REGISTRY_KEY] as Set<ClassType<any>>;
        return Array.from(store);
    }


    getSchema(entityClass: ClassType<any>): EntitySchema {
        let schema = this.schemaCache.get(entityClass);
        if (!schema) {
            schema = this.compileSchema(entityClass);
            this.schemaCache.set(entityClass, schema);

            // Alimentar índices de búsqueda instantánea O(1) al compilar
            this.nameIndex.set(entityClass.name, entityClass);
            this.sheetIndex.set(schema.sheetName, entityClass);
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

    getRelationsList<T extends object>(entityClass: ClassType<T>): string[] {
        return Object.keys(this.getSchema(entityClass).relations);
    }

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

    getRelationOptions(entityClass: ClassType<any>, relationName: string): CompiledRelation | undefined {
        return this.getSchema(entityClass).relations[relationName];
    }

    // 🔥 OPTIMIZACIÓN: Búsqueda O(1) usando el índice precompilado
    getEntityBySheetName(sheetName: string): ClassType<any> | undefined {
        const targetSheetName = sheetName.toUpperCase();

        // Si no está en el índice, forzamos la compilación de todas las entidades
        if (!this.sheetIndex.has(targetSheetName)) {
            MetadataRegistry.getAllRegisteredEntities().forEach(e => this.getSchema(e));
        }

        return this.sheetIndex.get(targetSheetName);
    }

    // 🔥 OPTIMIZACIÓN: Búsqueda O(1)
    getEntityByName(className: string): ClassType<any> | undefined {
        if (!this.nameIndex.has(className)) {
            MetadataRegistry.getAllRegisteredEntities().forEach(e => this.getSchema(e));
        }
        return this.nameIndex.get(className);
    }

    getColumnNamesForGas<T extends object>(entityClass: ClassType<T>): string[] {
        const schema = this.getSchema(entityClass);
        return schema.columnList.map(prop => schema.columns[prop]?.name || prop);
    }

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

            if (rawRel.isMany) {
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

    // ------------------ MÉTODOS DE REGISTRO ESTÁTICO ------------------
    static registerEntity(entity: Function) {
        this.entities.add(entity);
    }


}