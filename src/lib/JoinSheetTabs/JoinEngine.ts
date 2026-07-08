import { Injectable, Logger } from "@nestjs/common";
import { RepositoryRegistry } from "../core/repository/repository.registry";
import { ClassType } from "../core/types/common.types";
import { MetadataRegistry } from "./metadata.registry";

export interface JoinConfig {
    localField: string;     // ej: 'idObrero'
    targetRepo: any;        // El repositorio de la entidad hija
    foreignKey: string;     // ej: 'idObrero' en AdelantoEntity
}

@Injectable()
export class JoinEngine {
    private readonly logger = new Logger(JoinEngine.name);

    constructor(private readonly metadataRegistry: MetadataRegistry) { }

    async execute<T extends object>(
        parents: T[],
        parentEntityClass: ClassType<T>,
        propertyName: string,
        childProjection?: Record<string, number>
    ): Promise<T[]> {
        if (!parents || parents.length === 0) return parents;

        // 1. Obtener contrato limpio desde el Registry
        const config = this.metadataRegistry.getJoinConfig(parentEntityClass, propertyName);
        if (!config) {
            this.logger.warn(`⚠️ [JoinEngine] No hay metadata de relación para '${propertyName}' en ${parentEntityClass.name}`);
            return parents;
        }

        // 2. Obtener repositorio hijo de forma automática
        const targetRepo = RepositoryRegistry.getRepo(config.targetEntity);

        // 3. Extraer IDs únicos usando el localField dinámico (Adiós al p.id hardcodeado)
        const parentIds = [...new Set(
            parents
                .map(p => (p as any)[config.localField])
                .filter(val => val !== undefined && val !== null && val !== '')
        )];

        if (parentIds.length === 0) return parents;

        // 4. 🛡️ PROTECCIÓN DE PROYECCIÓN: Si piden 'adelantos.monto', debemos forzar 
        // que Sheets también traiga 'idObrero', o el Map en memoria se romperá.
        const findOptions: any = {};
        if (childProjection && Object.keys(childProjection).length > 0) {
            findOptions.projection = {
                ...childProjection,
                [config.foreignKey]: 1 // 👈 Inyección silenciosa de la FK obligatoria
            };
        }

        // 5. Batch Fetch: 1 sola consulta a la pestaña hija
        const children = await targetRepo.find({
            [config.foreignKey]: { $in: parentIds }
        }, findOptions);

        // 6. Indexación O(1) en memoria Hash Table
        const map = new Map<any, any[]>();
        for (const child of children) {
            const key = child[config.foreignKey];
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(child);
        }

        // 7. Hydration: Inyección de datos en los padres
        return parents.map(parent => {
            const parentKeyVal = (parent as any)[config.localField];
            const related = map.get(parentKeyVal) || [];
            return {
                ...parent,
                [propertyName]: config.isMany ? related : (related[0] || null)
            };
        });
    }
}