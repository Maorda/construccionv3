// src/lib/engine/populate.engine.ts
import { Injectable, forwardRef, Inject, Logger } from '@nestjs/common';
import { MetadataRegistry, CompiledRelation } from '../metadata/metadata.registry';
import { DataSourceManager } from '../data-source-manager';
import { ClassType } from '../types/common.types';
import { buildPopulateTree, PopulateTree } from './populate.utils';
import { ModuleRef } from '@nestjs/core';

@Injectable()
export class PopulateEngine {
    private readonly logger = new Logger(PopulateEngine.name);
    constructor(
        private readonly metadataRegistry: MetadataRegistry,
        private readonly moduleRef: ModuleRef

    ) { }

    /**
     * Punto de entrada principal
     */
    async populate<T extends object, DocType extends object>( // 🔥 Cambiamos 'extends T' por 'extends object'
        documents: DocType[],
        entityClass: ClassType<T>,
        populateInput: string | string[]
    ): Promise<DocType[]> {
        if (!documents || documents.length === 0) return documents;

        const paths = Array.isArray(populateInput) ? populateInput : [populateInput];
        const tree = buildPopulateTree(paths);

        await this.populateLevel<T, DocType>(documents, entityClass, tree);
        return documents;
    }
    private async populateLevel<T extends object, DocType extends object>( // 🔥 Igual aquí
        documents: DocType[],
        entityClass: ClassType<T>,
        tree: PopulateTree
    ): Promise<void> {
        const populateKeys = Object.keys(tree);
        if (populateKeys.length === 0) return;

        for (const propertyName of populateKeys) {
            const relationConfig = this.metadataRegistry.getRelationOptions(entityClass, propertyName);

            if (!relationConfig) {
                this.logger.warn(`Relación '${propertyName}' no encontrada en ${entityClass.name}`);
                continue;
            }

            const targetClass = relationConfig.targetEntity();
            const targetPK = this.metadataRegistry.getPrimaryKeyField(targetClass);
            const localPK = this.metadataRegistry.getPrimaryKeyField(entityClass);

            // 🚀 Resolución Dinámica del Modelo Destino vía NestJS
            let targetModel: any;
            try {
                // Usamos el token generado por tu InjectModel (ej: 'FotoModel')
                const modelToken = `${targetClass.name}Model`;
                targetModel = this.moduleRef.get(modelToken, { strict: false });
            } catch (error) {
                this.logger.error(`No se pudo resolver el modelo para ${targetClass.name} en ModuleRef.`);
                continue;
            }

            // Extracción de IDs y Batch Loading
            let relatedDocs: any[] = [];
            if (!relationConfig.isMany) {
                const joinCol = relationConfig.joinColumn;
                const ids = [...new Set(documents.map(d => (d as any)[joinCol]))].filter(Boolean);

                if (ids.length > 0) {
                    relatedDocs = await targetModel.find({ [targetPK]: { $in: ids } });
                }
            } else {
                const mappedBy = relationConfig.localField || `${entityClass.name.toLowerCase()}Id`;
                const parentIds = [...new Set(documents.map(d => (d as any)[localPK]))].filter(Boolean);

                if (parentIds.length > 0) {
                    relatedDocs = await targetModel.find({ [mappedBy]: { $in: parentIds } });
                }
            }

            // Mapeo en Memoria O(N)
            const map = new Map();
            for (const doc of relatedDocs) {
                const key = !relationConfig.isMany
                    ? (doc as any)[targetPK]
                    : (doc as any)[relationConfig.localField || `${entityClass.name.toLowerCase()}Id`];

                if (!map.has(key)) map.set(key, relationConfig.isMany ? [] : null);

                if (relationConfig.isMany) map.get(key).push(doc);
                else map.set(key, doc);
            }

            // Inyección en los documentos actuales
            for (const doc of documents) {
                const key = !relationConfig.isMany ? (doc as any)[relationConfig.joinColumn] : (doc as any)[localPK];
                (doc as any)[propertyName] = map.get(key) || (relationConfig.isMany ? [] : null);
            }

            // Recursión para el siguiente nivel de profundidad
            const nextLevelTree = tree[propertyName];
            if (Object.keys(nextLevelTree).length > 0 && relatedDocs.length > 0) {
                await this.populateLevel(relatedDocs, targetClass, nextLevelTree);
            }
        }
    }



}