import { Injectable, Scope, BadRequestException } from "@nestjs/common";
import { PipelineOrchestrator } from "./pipeline.registry";
import { GroupConfig, LookupConfig, PipelineStage } from "./interfaces/query-stage.interface";


// 🟢 CRÍTICO: Definimos el Scope como TRANSIENT para que cada inyección 
// genere un Builder único y evitar contaminación de memoria entre peticiones.
@Injectable({ scope: Scope.TRANSIENT })
export class AggregationBuilder {
    private pipeline: PipelineStage[] = [];

    constructor(
        private readonly pipelineOrchestrator: PipelineOrchestrator
    ) { }

    match(criteria: Record<string, any>): this {
        if (!criteria || typeof criteria !== 'object') {
            throw new BadRequestException("El criterio de '$match' debe ser un objeto válido.");
        }
        this.pipeline.push({ $match: criteria });
        return this;
    }

    lookup(config: LookupConfig): this {
        if (!config || !config.from || !config.localField || !config.foreignField || !config.as) {
            throw new BadRequestException("Configuración incompleta para el stage '$lookup'.");
        }
        this.pipeline.push({ $lookup: config });
        return this;
    }

    project(criteria: Record<string, any>): this {
        if (!criteria || typeof criteria !== 'object') {
            throw new BadRequestException("La proyección de '$project' debe ser un objeto.");
        }
        this.pipeline.push({ $project: criteria });
        return this;
    }

    sort(criteria: Record<string, any>): this {
        if (!criteria || typeof criteria !== 'object') {
            throw new BadRequestException("El ordenamiento de '$sort' debe ser un objeto.");
        }
        this.pipeline.push({ $sort: criteria });
        return this;
    }

    group(criteria: Partial<GroupConfig>): this {
        const fullCriteria: GroupConfig = {
            _id: null,
            ...criteria
        };
        this.pipeline.push({ $group: fullCriteria });
        return this;
    }

    unwind(criteria: string | { path: string }): this {
        if (!criteria) {
            throw new BadRequestException("El stage '$unwind' requiere un path o una configuración.");
        }
        this.pipeline.push({ $unwind: criteria });
        return this;
    }

    addFields(criteria: Record<string, any>): this {
        if (!criteria || typeof criteria !== 'object') {
            throw new BadRequestException("Los campos de '$addFields' deben venir en formato de objeto.");
        }
        this.pipeline.push({ $addFields: criteria });
        return this;
    }

    limit(criteria: number): this {
        // 🟢 VALIDACIÓN DE PRODUCCIÓN: Evitar números negativos o no enteros
        if (typeof criteria !== 'number' || criteria <= 0) {
            throw new BadRequestException("El límite de '$limit' debe ser un número entero mayor a 0.");
        }
        this.pipeline.push({ $limit: Math.floor(criteria) });
        return this;
    }

    skip(criteria: number): this {
        // 🟢 VALIDACIÓN DE PRODUCCIÓN: Evitar saltos negativos
        if (typeof criteria !== 'number' || criteria < 0) {
            throw new BadRequestException("El salto de '$skip' debe ser un número entero mayor o igual a 0.");
        }
        this.pipeline.push({ $skip: Math.floor(criteria) });
        return this;
    }

    /**
     * Devuelve el pipeline actual construido hasta el momento (Útil para debugging o tests)
     */
    public getPipeline(): PipelineStage[] {
        return [...this.pipeline];
    }

    async runStages(data: any[]): Promise<any[]> {
        if (!Array.isArray(data)) {
            throw new BadRequestException("Los datos a procesar en el pipeline deben ser un array.");
        }

        // Si no hay stages, devolvemos la data original intacta de forma segura
        if (this.pipeline.length === 0) return [...data];

        try {
            // 🟢 PRODUCCIÓN: Hacemos una copia superficial del pipeline para ejecutarlo
            // y limpiamos el estado de la instancia inmediatamente.
            const pipelineToExecute = [...this.pipeline];
            this.pipeline = [];

            return await this.pipelineOrchestrator.executePipeline(data, pipelineToExecute as any);
        } catch (error) {
            // Aseguramos la limpieza del pipeline incluso si el orquestador falla
            this.pipeline = [];
            throw error;
        }
    }
}