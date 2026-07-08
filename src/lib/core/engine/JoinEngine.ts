import { Injectable } from "@nestjs/common";

export interface JoinConfig {
    localField: string;     // ej: 'idObrero'
    targetRepo: any;        // El repositorio de la entidad hija
    foreignKey: string;     // ej: 'idObrero' en AdelantoEntity
}

@Injectable()
export class JoinEngine {

    async execute(parents: any[], config: JoinConfig, propertyName: string): Promise<any[]> {
        // 1. Colección de IDs únicos (Eliminar duplicados para optimizar)
        const parentIds = [...new Set(parents.map(p => p.id).filter(Boolean))];

        if (parentIds.length === 0) return parents;

        // 2. Batch Fetch: Una sola consulta para todos los hijos
        const children = await config.targetRepo.find({
            [config.foreignKey]: { $in: parentIds }
        });

        // 3. Indexación: Creamos un mapa { idObrero: [adelantos...] }
        const map = new Map<string, any[]>();

        for (const child of children) {
            const key = child[config.foreignKey];
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(child);
        }

        // 4. Hydration: Asignamos el array al objeto padre
        return parents.map(parent => ({
            ...parent,
            [propertyName]: map.get(parent.id) || []
        }));
    }
}