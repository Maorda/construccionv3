import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { IQueryStage } from "./interfaces/query-stage.interface";
import { ExpressionEngine } from "./expression.engine";
import { MetadataRegistry } from "../core/metadata/metadata.registry";

// ==========================================
// 1. GROUP STAGE ($group)
// ==========================================
@Injectable()
export class GroupStage implements IQueryStage {
    // 🔥 Corrección: Se estandariza a minúscula para que el motor lo detecte correctamente
    public readonly operator = '$group';

    constructor(private readonly expressionEngine: ExpressionEngine) { }

    validate(config: any): void {
        if (!config || typeof config !== 'object') {
            throw new Error("[$group] Requiere una configuración de objeto válida.");
        }
    }

    execute(data: any[], config: any): any[] {
        const { _id, ...accumulators } = config;
        const groups = new Map<string, any>();

        const AGG_SUM = Symbol('sum');
        const AGG_CNT = Symbol('cnt');

        for (const item of data) {
            // 🟢 Resuelve el ID del grupo usando evaluate (soporta paths anidados)
            const resolvedId = _id !== undefined ? this.expressionEngine.evaluate(_id, item) : null;
            const groupId = resolvedId !== null && resolvedId !== undefined ? String(resolvedId) : 'root';

            if (!groups.has(groupId)) {
                groups.set(groupId, { _id: groupId === 'root' ? null : resolvedId });
            }

            const group = groups.get(groupId);

            // 🟢 Iteramos sobre las operaciones ($sum, $avg, etc.)
            for (const [key, accConfig] of Object.entries<any>(accumulators)) {
                if (!accConfig || typeof accConfig !== 'object') continue;

                const [op, fieldPath] = Object.entries(accConfig)[0];
                const value = this.expressionEngine.evaluate(fieldPath, item);

                switch (op) {
                    case '$sum':
                        group[key] = (group[key] || 0) + (Number(value) || 0);
                        break;
                    case '$count':
                        group[key] = (group[key] || 0) + 1;
                        break;
                    case '$avg':
                        group[key] = group[key] || { [AGG_SUM]: 0, [AGG_CNT]: 0 };
                        group[key][AGG_SUM] += (Number(value) || 0);
                        group[key][AGG_CNT] += 1;
                        break;
                    case '$min':
                        const numMin = Number(value);
                        if (!isNaN(numMin)) {
                            group[key] = group[key] === undefined ? numMin : Math.min(group[key], numMin);
                        }
                        break;
                    case '$max':
                        const numMax = Number(value);
                        if (!isNaN(numMax)) {
                            group[key] = group[key] === undefined ? numMax : Math.max(group[key], numMax);
                        }
                        break;
                    case '$push':
                        group[key] = group[key] || [];
                        group[key].push(value);
                        break;
                }
            }
        }

        // 🟢 Formateo final (ej: resolver los promedios)
        return Array.from(groups.values()).map(g => {
            for (const key in g) {
                if (g[key] && typeof g[key] === 'object' && AGG_SUM in g[key]) {
                    g[key] = g[key][AGG_SUM] / (g[key][AGG_CNT] || 1);
                }
            }
            return g;
        });
    }
}

// ==========================================
// 2. LOOKUP STAGE ($lookup)
// ==========================================
@Injectable()
export class LookupStage implements IQueryStage {
    private readonly logger = new Logger(LookupStage.name);
    public readonly operator = '$lookup';

    constructor(
        private readonly moduleRef: ModuleRef,
        private readonly metadataRegistry: MetadataRegistry,
        private readonly expressionEngine: ExpressionEngine
    ) { }

    validate(config: any): void {
        if (!config?.from || !config?.localField || !config?.foreignField || !config?.as) {
            throw new BadRequestException("Configuración incompleta para $lookup.");
        }
    }

    async execute(data: any[], config: any): Promise<any[]> {
        const { from, localField, foreignField, as } = config;

        const entityClass = this.metadataRegistry.getEntityBySheetName(from);
        if (!entityClass) {
            this.logger.error(`No se encontró entidad para la hoja: '${from}'`);
            return data;
        }

        const repositoryToken = `SheetsRepository_${entityClass.name}`;
        let foreignRepository: any;

        try {
            // 🔥 Obtenemos el repositorio privado que creaste en el forFeature
            foreignRepository = this.moduleRef.get(repositoryToken, { strict: false });
        } catch {
            this.logger.error(`Repositorio no registrado: ${repositoryToken}`);
            return data;
        }

        // Traemos los datos. Si tu repositorio devuelve proxies, extraemos la raw data
        const foreignDataRaw = await foreignRepository.find({}, { includeInactive: true }) ?? [];

        // 🟢 Index Map O(N+M)
        const indexMap = foreignDataRaw.reduce((map, item) => {
            // Extraer raw data si es un proxy de Mongoose-style
            const rawItem = this.expressionEngine.extractRawData ? this.expressionEngine.extractRawData(item) : item;

            const foreignValue = this.expressionEngine.evaluate(`$${foreignField}`, rawItem);

            if (foreignValue !== undefined && foreignValue !== null) {
                const key = String(foreignValue).trim();
                if (!map.has(key)) map.set(key, []);
                map.get(key)!.push(item);
            }
            return map;
        }, new Map<string, any[]>());

        // 🟢 Mapeo final cruzando colecciones
        return data.map(item => {
            const rawItem = this.expressionEngine.extractRawData ? this.expressionEngine.extractRawData(item) : item;
            const localValue = this.expressionEngine.evaluate(`$${localField}`, rawItem);
            const lookupKey = localValue !== undefined && localValue !== null ? String(localValue).trim() : '';

            return {
                ...item,
                [as]: indexMap.get(lookupKey) || []
            };
        });
    }
}

// ==========================================
// 3. UNWIND STAGE ($unwind)
// ==========================================
@Injectable()
export class UnwindStage implements IQueryStage {
    public readonly operator = '$unwind';

    validate(config: any): void {
        if (!config || (typeof config !== 'string' && typeof config !== 'object')) {
            throw new Error("[$unwind] requiere un string o un objeto con la propiedad 'path'.");
        }

        if (typeof config === 'object' && !config.path) {
            throw new Error("[$unwind] El objeto de configuración debe contener la propiedad 'path'.");
        }
    }

    async execute(data: any[], config: string | { path: string }) {
        const path = typeof config === 'string' ? config : config.path;
        const field = path.replace('$', '');

        return data.flatMap(item => {
            const arr = item[field];

            // Si no es array o está vacío, devolvemos el item intacto
            // (Comportamiento estándar de MongoDB es omitirlo, pero puedes configurarlo)
            if (!Array.isArray(arr) || arr.length === 0) return item;

            return arr.map(subItem => ({ ...item, [field]: subItem }));
        });
    }
}