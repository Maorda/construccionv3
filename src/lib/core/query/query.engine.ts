import { Inject, Injectable, Logger } from '@nestjs/common';
import { FilterQuery, QueryOptions } from '../model/model.factory';
import { IQueryStage, PipelineStage } from '../../stages/interfaces/query-stage.interface';
import { PIPELINE_STAGE } from '../../stages/pipeline.constants';
import { DateTransformer } from '../../stages/transform.operators';

export type AggregationPipeline = PipelineStage[];

export interface IQueryEngine {
    execute<T>(data: T[], filter: FilterQuery<T>, options?: QueryOptions): Promise<T[]>;
    aggregate<R = any>(data: any[], pipeline: AggregationPipeline): Promise<R[]>;
}

@Injectable()
export class QueryEngine implements IQueryEngine {
    private readonly stageRegistry: Map<string, IQueryStage>;
    // 🚀 Cambiado a la instancia nativa del Logger de NestJS para mejor formato en consola
    private readonly logger = new Logger(QueryEngine.name);

    constructor(
        // Inyectamos el arreglo de stages resuelto dinámicamente por la fábrica del módulo
        @Inject(PIPELINE_STAGE) private readonly stages: IQueryStage[]
    ) {
        this.stageRegistry = new Map<string, IQueryStage>();

        // Registro Dinámico Automático leyendo la propiedad de cada Stage instanciado
        for (const stage of this.stages) {
            // Mejor validación
            if (!stage || typeof stage.operator !== 'string') {
                throw new Error(`[QueryEngine] Invalid stage injected. A valid 'operator' string is required in ${stage?.constructor?.name || 'UnknownStage'}.`);
            }
            this.stageRegistry.set(stage.operator, stage);
        }

        // 🔍 LOG STAGE REGISTRY: Confirmación única al levantar el módulo
        this.logger.log(`⚙️ QueryEngine inicializado correctamente. [${this.stageRegistry.size}] operadores registrados.`);
    }

    public async execute<T>(data: T[], filter: FilterQuery<T>, options?: QueryOptions): Promise<any[]> {
        const pipeline: any[] = [];

        // 🔍 LOG DE ENTRADA AL ENGINE: Registra qué le pide el repositorio al motor
        this.logger.debug(`[execute] Solicitud de consulta. Registros entrantes en memoria: ${data?.length || 0}. Filtro base: ${JSON.stringify(filter)}`);
        const normalizedFilter = this.normalizeFilter(filter);

        if (normalizedFilter && Object.keys(normalizedFilter).length > 0) {
            pipeline.push({ $match: normalizedFilter });
        }
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
            this.logger.warn(`[aggregate] Se invocó la agregación pero el pipeline está vacío. Retornando datos sin procesar.`);
            return data as unknown as R[];
        }

        // Validación preventiva antes de arrancar la iteración pesada
        this.validatePipeline(pipeline);

        let result: any[] = [...data];

        // 🔍 LOG MACRO PIPELINE: Muestra la tubería completa que se va a procesar en esta tanda
        this.logger.debug(`[aggregate] Iniciando Pipeline de Agregación con ${pipeline.length} etapas activas.`);

        // Procesamiento en cadena (El output de una etapa alimenta la entrada de la siguiente)
        for (const stage of pipeline) {
            const operator = Object.keys(stage)[0];
            const config = stage[operator];
            const handler = this.stageRegistry.get(operator)!;

            // Almacenamos el tamaño del array antes de entrar al handler
            const countBefore = result.length;

            if (operator === '$match' && result.length > 0) {
                this.logger.debug(`[DIAGNOSTICO-MATCH] Analizando ${result.length} items vs Filtro: ${JSON.stringify(config)}`);
                const sampleItem = result[0];
                const itemKeys = Object.keys(sampleItem as object);
                this.logger.debug(`[DIAGNOSTICO-MATCH] Keys del item: ${JSON.stringify(itemKeys)}`);

                // Verificación rápida de mismatch de llaves
                const filterKeys = Object.keys(config);
                const missingKeys = filterKeys.filter(k => !itemKeys.includes(k));
                if (missingKeys.length > 0) {
                    this.logger.warn(`[DIAGNOSTICO-MATCH] ⚠️ ADVERTENCIA: El filtro busca llaves que no existen en los datos: ${JSON.stringify(missingKeys)}`);
                }
            }

            try {
                // Ejecutamos la transformación del Stage en memoria
                result = await handler.execute(result, config);

                // 🔍 LOG MICRO STAGE: Muestra la variación exacta de los registros tras aplicar el operador
                // Usamos verbose() para no saturar entornos productivos si el nivel está configurado en log/error
                this.logger.verbose(`   ├── Stage [${operator}]: Filas antes: ${countBefore} ➡️ Filas remanentes: ${result.length}. Config: ${JSON.stringify(config)}`);

            } catch (error: any) {
                this.logger.error(`[QueryEngine] ❌ Error crítico ejecutando la etapa "${operator}" con la configuración: ${JSON.stringify(config)}`);
                throw new Error(`[QueryEngine] ❌ Error ejecutando etapa "${operator}": ${error.message}`);
            }
        }

        // 🔍 LOG DE SALIDA: Resultado definitivo final de todo el pipeline
        this.logger.debug(`[aggregate] Pipeline completado con éxito. Registros devueltos al repositorio: ${result.length}`);

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
    private normalizeFilter(filter: any): any {
        if (!filter) return filter;

        // Si detecta un string de fecha en el filtro, lo normaliza a formato de sistema (YYYY-MM-DD)
        if (typeof filter === 'string' && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(filter)) {
            return DateTransformer.fromSheet(filter);
        }

        if (Array.isArray(filter)) return filter.map(i => this.normalizeFilter(i));
        if (typeof filter === 'object') {
            const normalized: any = {};
            for (const [key, val] of Object.entries(filter)) {
                normalized[key] = this.normalizeFilter(val);
            }
            return normalized;
        }
        return filter;
    }
}