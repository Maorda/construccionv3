// src/lib/engine/populate.engine.ts
import { Injectable, Logger } from '@nestjs/common';
import { MetadataRegistry } from '../metadata/metadata.registry';
import { ClassType } from '../types/common.types';
import { buildPopulateTree, PopulateTree } from './populate.utils';
import { ModelRegistry } from '../model/model.registry';

@Injectable()
export class PopulateEngine {
    private readonly logger = new Logger(PopulateEngine.name);
    constructor(
        private readonly metadataRegistry: MetadataRegistry,
    ) { }

    /**
     * Punto de entrada principal
     */
    async populate<T extends object, DocType extends object>(
        documents: DocType[],
        entityClass: ClassType<T>,
        populateInput: string | string[]
    ): Promise<DocType[]> {
        if (!documents || documents.length === 0) {
            this.logger.verbose(`[populate] No hay documentos para poblar en ${entityClass.name}.`);
            return documents;
        }

        const paths = Array.isArray(populateInput) ? populateInput : [populateInput];
        const tree = buildPopulateTree(paths);

        this.logger.debug(`[populate] 📂 Iniciando proceso para [${entityClass.name}]. Documentos base: ${documents.length}. Paths solicitados: [${paths.join(', ')}]`);

        await this.populateLevel<T, DocType>(documents, entityClass, tree);

        this.logger.debug(`[populate] ✅ Proceso de populación finalizado con éxito para [${entityClass.name}].`);
        return documents;
    }

    private async populateLevel<T extends object, DocType extends object>(
        documents: DocType[],
        entityClass: ClassType<T>,
        tree: PopulateTree
    ): Promise<void> {
        const populateKeys = Object.keys(tree);
        if (populateKeys.length === 0) return;

        for (const propertyName of populateKeys) {
            this.logger.debug(`  └── 🔍 Procesando propiedad relacional: '${propertyName}' en la entidad ${entityClass.name}`);

            // 1. Obtenemos el contrato exacto generado por @SubCollection
            const relationConfig = this.metadataRegistry.getRelationOptions(entityClass, propertyName);

            if (!relationConfig) {
                this.logger.warn(`  ├── ⚠️ Relación '${propertyName}' no encontrada en los metadatos de ${entityClass.name}. Saltando.`);
                continue;
            }

            const targetClass = relationConfig.targetEntity();
            const targetPK = this.metadataRegistry.getPrimaryKeyField(targetClass) as string;
            const localPK = this.metadataRegistry.getPrimaryKeyField(entityClass) as string;
            const joinColumn = relationConfig.joinColumn as string;

            if (!joinColumn) {
                this.logger.error(`  ├── ❌ Error Crítico: 'joinColumn' es undefined para '${propertyName}' en ${entityClass.name}.`);
                continue;
            }

            // 2. Resolución Dinámica en el ModelRegistry Global
            const targetModel = ModelRegistry.get(targetClass.name);

            if (!targetModel) {
                this.logger.error(`  ├── ❌ Modelo no registrado en ModelRegistry: ${targetClass.name}. Verifica el 'forFeature'.`);
                continue;
            }

            // 3. Batch Loading de Documentos Relacionados
            let relatedDocs: any[] = [];

            if (relationConfig.isMany) {
                // Escenario SubCollection (Ej: Obrero -> Adelantos)
                const parentIds = [...new Set(documents.map(d => (d as any)[localPK]))].filter(Boolean);
                this.logger.verbose(`  ├── [Batch-Load] Extrayendo IDs locales (${localPK}) de ${entityClass.name}. Encontrados: ${parentIds.length} IDs únicos.`);

                if (parentIds.length > 0) {
                    const queryFilter = { [joinColumn]: { $in: parentIds } };
                    this.logger.verbose(`  ├── [Query] Buscando en [${targetClass.name}] con filtro: ${JSON.stringify(queryFilter)}`);

                    relatedDocs = await targetModel.find(queryFilter);
                }
            } else {
                // Escenario Relación Simple/Reference (Ej: Adelanto -> Obrero)
                const foreignIds = [...new Set(documents.map(d => (d as any)[joinColumn]))].filter(Boolean);
                this.logger.verbose(`  ├── [Batch-Load] Extrayendo FKs (${joinColumn}) de ${entityClass.name}. Encontradas: ${foreignIds.length} FKs únicas.`);

                if (foreignIds.length > 0) {
                    const queryFilter = { [targetPK]: { $in: foreignIds } };
                    this.logger.verbose(`  ├── [Query] Buscando en [${targetClass.name}] con filtro: ${JSON.stringify(queryFilter)}`);

                    relatedDocs = await targetModel.find(queryFilter);
                }
            }

            this.logger.debug(`  ├── 📦 Documentos relacionados recuperados de la base de datos: ${relatedDocs.length}`);

            // 4. Mapeo en Memoria O(N)
            const map = new Map<string | number, any>();

            for (const doc of relatedDocs) {
                const key = relationConfig.isMany ? doc[joinColumn] : doc[targetPK];

                if (!map.has(key)) {
                    map.set(key, relationConfig.isMany ? [] : null);
                }

                if (relationConfig.isMany) {
                    map.get(key).push(doc);
                } else {
                    map.set(key, doc);
                }
            }

            // 5. Inyección de dependencias en los documentos originales
            let injectionCount = 0;
            for (const doc of documents) {
                const key = relationConfig.isMany ? (doc as any)[localPK] : (doc as any)[joinColumn];
                const dataToInject = map.get(key) || (relationConfig.isMany ? [] : null);

                (doc as any)[propertyName] = dataToInject;

                if (relationConfig.isMany ? dataToInject.length > 0 : dataToInject !== null) {
                    injectionCount++;
                }
            }

            this.logger.debug(`  ├── 💉 Inyección completada. [${injectionCount}/${documents.length}] documentos de ${entityClass.name} recibieron datos para '${propertyName}'.`);

            // 6. Recursión para el siguiente nivel de profundidad
            const nextLevelTree = tree[propertyName];
            if (Object.keys(nextLevelTree).length > 0 && relatedDocs.length > 0) {
                this.logger.debug(`  └── 🔄 Avanzando al siguiente nivel de profundidad de población para '${propertyName}'...`);
                await this.populateLevel(relatedDocs, targetClass, nextLevelTree);
            }
        }
    }
}