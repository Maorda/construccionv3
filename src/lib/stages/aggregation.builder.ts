import { Injectable, Scope, BadRequestException } from "@nestjs/common";
import { PipelineOrchestrator } from "./pipeline.registry";
import { GroupConfig, LookupConfig, PipelineStage } from "./interfaces/query-stage.interface";
import { StageUtils } from "./StageUtils";


// 🟢 CRÍTICO: Definimos el Scope como TRANSIENT para que cada inyección 
// genere un Builder único y evitar contaminación de memoria entre peticiones.
@Injectable()
export class AggregationBuilder {
    private pipeline: PipelineStage[] = [];

    constructor(
        private readonly pipelineOrchestrator: PipelineOrchestrator
    ) { }

    match(criteria: Record<string, any>): this {
        StageUtils.validateObject(criteria, '$match');
        this.pipeline.push({ $match: criteria });
        return this;
    }

    lookup(config: LookupConfig): this {
        StageUtils.validateObject(config, '$lookup');
        this.pipeline.push({ $lookup: config });
        return this;
    }

    project(criteria: Record<string, any>): this {
        StageUtils.validateObject(criteria, '$project');
        this.pipeline.push({ $project: criteria });
        return this;
    }

    sort(criteria: Record<string, any>): this {
        StageUtils.validateObject(criteria, '$sort');
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
        if (typeof criteria === 'string') {
            criteria = { path: criteria };
        }
        StageUtils.validateObject(criteria, '$unwind');
        this.pipeline.push({ $unwind: criteria });
        return this;
    }

    addFields(criteria: Record<string, any>): this {
        StageUtils.validateObject(criteria, '$addFields');
        this.pipeline.push({ $addFields: criteria });
        return this;
    }

    limit(criteria: number): this {
        StageUtils.validateObject(criteria, '$limit');
        this.pipeline.push({ $limit: Math.floor(criteria) });
        return this;
    }

    skip(criteria: number): this {
        StageUtils.validateObject(criteria, '$skip');
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
        StageUtils.validateArray(data, '$runStages');

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