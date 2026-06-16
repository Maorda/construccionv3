import { Module } from '@nestjs/common';

// 1. Importaciones usando el patrón barril (asegúrate de crear estos index.ts)
import * as AllStages from './stages';
import * as AllFilters from './operators/filters';
import * as AllTransforms from './operators/transforms';

import { DATA_TRANSFORM_OPERATOR, FILTER_OPERATOR, PIPELINE_STAGE } from './constants/pipeline.constants';
import { AggregationBuilder } from './engine/aggregation.builder';
import { ExpressionEngine } from './engine/expression.engine';
import { PipelineOrchestrator } from './engine/pipeline.registry';
import { QueryEngine } from './engine/query.engine'; // 👈 ¡Añadido!

// 2. Convertimos los objetos de exportación en Arrays de clases
const STAGES = Object.values(AllStages);
const FILTERS = Object.values(AllFilters);
const TRANSFORMS = Object.values(AllTransforms);

@Module({
    providers: [
        // 3. Registramos todas las clases individualmente
        ...STAGES,
        ...FILTERS,
        ...TRANSFORMS,

        // Motores base
        ExpressionEngine,
        PipelineOrchestrator,
        AggregationBuilder,
        QueryEngine, // 👈 El cerebro que ejecuta los pipelines

        // 4. Inyectamos las colecciones dinámicas bajo sus Tokens
        {
            provide: PIPELINE_STAGE,
            useFactory: (...stages: any[]) => stages,
            inject: STAGES,
        },
        {
            provide: FILTER_OPERATOR,
            useFactory: (...filters: any[]) => filters,
            inject: FILTERS,
        },
        {
            provide: DATA_TRANSFORM_OPERATOR,
            useFactory: (...transforms: any[]) => transforms,
            inject: TRANSFORMS,
        }
    ],
    exports: [
        // Exportamos solo lo que la librería (Repositorio) necesita usar
        AggregationBuilder,
        QueryEngine
    ]
})
export class QueryEngineModule { } // Renombrado para mayor claridad