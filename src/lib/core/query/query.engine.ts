import { Inject, Injectable } from '@nestjs/common';
import { FilterQuery, QueryOptions } from '../model/model.factory';
import { IQueryStage, PipelineStage } from '../../stages/interfaces/query-stage.interface';
import { PIPELINE_STAGE } from '../../stages/pipeline.constants';

export type AggregationPipeline = PipelineStage[];

export interface IQueryEngine {
    execute<T>(data: T[], filter: FilterQuery<T>, options?: QueryOptions): Promise<T[]>;
    aggregate<R = any>(data: any[], pipeline: AggregationPipeline): Promise<R[]>;
}

@Injectable()
export class QueryEngine implements IQueryEngine {
    private readonly stageRegistry: Map<string, IQueryStage>;

    constructor(
        // Inyectamos todas las instancias de los stages que declaraste en el módulo
        @Inject(PIPELINE_STAGE) private readonly stages: IQueryStage[]
    ) {
        this.stageRegistry = new Map<string, IQueryStage>();

        // 🔥 Registro Dinámico y Automático:
        // Ahora el QueryEngine no sabe qué clases existen, simplemente le 
        // pregunta a cada stage cuál es su "operator" y lo registra.
        for (const stage of this.stages) {
            if (!stage.operator) {
                throw new Error(`[QueryEngine] El stage ${stage.constructor.name} no define la propiedad 'operator'.`);
            }
            this.stageRegistry.set(stage.operator, stage);
        }
    }

    public async execute<T>(data: T[], filter: FilterQuery<T>, options?: QueryOptions): Promise<any[]> {
        const pipeline: any[] = [];

        // Construcción del pipeline a partir de la consulta estándar
        if (filter && Object.keys(filter).length > 0) pipeline.push({ $match: filter });
        if (options?.sort) pipeline.push({ $sort: { [options.sort.field]: options.sort.order === 'ASC' ? 1 : -1 } });

        const skip = options?.skip ?? options?.offset ?? 0;
        if (skip > 0) pipeline.push({ $skip: skip });

        if (options?.limit !== undefined && options.limit !== null) pipeline.push({ $limit: options.limit });
        if (options?.projection) pipeline.push({ $project: options.projection });

        return await this.aggregate(data, pipeline);
    }

    private validatePipeline(pipeline: any[]): void {
        if (!Array.isArray(pipeline)) {
            throw new Error("[QueryEngine] El pipeline debe ser un array de estadios.");
        }

        for (const stage of pipeline) {
            const operator = Object.keys(stage)[0];
            const config = stage[operator];
            const handler = this.stageRegistry.get(operator);

            if (!handler) {
                throw new Error(`[QueryEngine] Operador no soportado: ${operator}`);
            }

            try {
                handler.validate(config);
            } catch (error: any) {
                throw new Error(`[QueryEngine] Validación fallida en etapa "${operator}": ${error.message}`);
            }
        }
    }

    public async aggregate<T, R = any>(data: T[], pipeline: AggregationPipeline): Promise<R[]> {
        if (!pipeline || pipeline.length === 0) {
            return data as unknown as R[];
        }

        // Validación preventiva antes de iterar
        this.validatePipeline(pipeline);

        let result: any[] = [...data];

        // Ejecución secuencial (Pipeline)
        for (const stage of pipeline) {
            const operator = Object.keys(stage)[0];
            const config = stage[operator];
            const handler = this.stageRegistry.get(operator)!;

            try {
                // El output de un stage es el input del siguiente
                result = await handler.execute(result, config);
            } catch (error: any) {
                throw new Error(`[QueryEngine] ❌ Error ejecutando etapa "${operator}": ${error.message}`);
            }
        }

        return result as R[];
    }
}