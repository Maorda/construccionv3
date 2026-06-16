import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { PIPELINE_STAGE } from './pipeline.constants.js';
import { IQueryStage } from "./interfaces/query-stage.interface"

@Injectable()
export class PipelineOrchestrator {
    private readonly logger = new Logger(PipelineOrchestrator.name);
    private readonly stagesMap: Map<string, IQueryStage> = new Map();

    constructor(@Optional() @Inject(PIPELINE_STAGE) private readonly stages: IQueryStage[]) {

        if (!Array.isArray(this.stages)) {
            console.error('ERROR CRÍTICO: stages no es un array, es:', typeof this.stages, this.stages);
        }
        // Mapeo automático inteligente basado en el nombre de la clase
        /* this.stages.forEach(stage => {
             const className = stage.constructor.name;
             const stageName = className.replace('Stage', '');

            // 🟢 SOLUCIÓN AL BUG: Convierte solo la primera letra a minúscula para soportar camelCase
            // Ejemplo: "AddFieldsStage" -> "AddFields" -> "$addFields"
            const operator = `$${stageName.charAt(0).toLowerCase()}${stageName.slice(1)}`;

            this.stagesMap.set(operator, stage);

            // Log de depuración para asegurar que los multi-providers se carguen correctamente en tu NPM library
            this.logger.log(`[PipelineOrchestrator] Stage registrado: ${operator} -> ${className}`);
        });*/
    }

    public async executePipeline(data: any[], pipeline: Record<string, any>[]): Promise<any[]> {
        // 🟢 BUENA PRÁCTICA: Clonamos superficialmente el array inicial para evitar mutaciones directas
        // por referencia en los datos crudos de origen.
        let result = [...data];

        for (const stageConfig of pipeline) {
            if (!stageConfig || typeof stageConfig !== 'object') continue;

            const operator = Object.keys(stageConfig)[0];
            const config = stageConfig[operator];
            const stage = this.stagesMap.get(operator);

            if (!stage) {
                this.logger.warn(`Stage no soportado u olvidado en la inyección del módulo: ${operator}`);
                continue;
            }

            try {
                // 1. Ejecuta las validaciones de negocio e integridad estructuradas de cada Stage
                stage.validate(config);

                // 2. Ejecuta la lógica aislada del Stage (soporta tanto promesas asíncronas como arrays puros)
                result = await stage.execute(result, config);
            } catch (error: any) {
                this.logger.error(`Error crítico en la ejecución del stage ${operator}: ${error.message}`);
                // Relanzamos el error para que rompa el flujo y no devuelva datos corruptos o incompletos
                throw error;
            }
        }
        return result;
    }
}