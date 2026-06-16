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
        // Inyectamos el arreglo de stages resuelto dinámicamente por la fábrica del módulo
        @Inject(PIPELINE_STAGE) private readonly stages: IQueryStage[]
    ) {
        this.stageRegistry = new Map<string, IQueryStage>();

        // Registro Dinámico Automático leyendo la propiedad de cada Stage instanciado
        for (const stage of this.stages) {
            if (!stage.operator) {
                throw new Error(`[QueryEngine] El stage ${stage.constructor.name} no define la propiedad obligatoria 'operator'.`);
            }
            this.stageRegistry.set(stage.operator, stage);
        }
    }

    public async execute<T>(data: T[], filter: FilterQuery<T>, options?: QueryOptions): Promise<any[]> {
        const pipeline: any[] = [];

        // Traducimos una consulta común (findOne, findMany) a un pipeline estructurado
        if (filter && Object.keys(filter).length > 0) {
            pipeline.push({ $match: filter });
        }

        if (options?.sort) {
            pipeline.push({ $sort: { [options.sort.field]: options.sort.order === 'ASC' ? 1 : -1 } });
        }

        const skip = options?.skip ?? options?.offset ?? 0;
        if (skip > 0) {
            pipeline.push({ $skip: skip });
        }

        if (options?.limit !== undefined && options.limit !== null) {
            pipeline.push({ $limit: options.limit });
        }

        if (options?.projection) {
            pipeline.push({ $project: options.projection });
        }

        return await this.aggregate(data, pipeline);
    }

    public async aggregate<T, R = any>(data: T[], pipeline: AggregationPipeline): Promise<R[]> {
        if (!pipeline || pipeline.length === 0) {
            return data as unknown as R[];
        }

        // Validación preventiva antes de arrancar la iteración pesada
        this.validatePipeline(pipeline);

        let result: any[] = [...data];

        // Procesamiento en cadena (El output de una etapa alimenta la entrada de la siguiente)
        for (const stage of pipeline) {
            const operator = Object.keys(stage)[0];
            const config = stage[operator];
            const handler = this.stageRegistry.get(operator)!;

            try {
                result = await handler.execute(result, config);
            } catch (error: any) {
                throw new Error(`[QueryEngine] ❌ Error ejecutando etapa "${operator}": ${error.message}`);
            }
        }

        return result as R[];
    }

    private validatePipeline(pipeline: any[]): void {
        if (!Array.isArray(pipeline)) {
            throw new Error("[QueryEngine] El pipeline de agregación debe ser obligatoriamente un array.");
        }

        for (const stage of pipeline) {
            const operator = Object.keys(stage)[0];
            const config = stage[operator];
            const handler = this.stageRegistry.get(operator);

            if (!handler) {
                throw new Error(`[QueryEngine] Operador no soportado en la infraestructura actual: ${operator}`);
            }

            try {
                handler.validate(config);
            } catch (error: any) {
                throw new Error(`[QueryEngine] Validación fallida en la etapa "${operator}": ${error.message}`);
            }
        }
    }
}