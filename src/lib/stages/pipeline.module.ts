import { Global, Module } from '@nestjs/common';

// 1. Constantes y Motores
import { DATA_TRANSFORM_OPERATOR, FILTER_OPERATOR, PIPELINE_STAGE } from './pipeline.constants';
import { AggregationBuilder } from './aggregation.builder';
import { ExpressionEngine } from './expression.engine';
import { PipelineOrchestrator } from './pipeline.registry';
import { QueryEngine } from '../core/query/query.engine'; // 🌟 Añadido el motor principal

// 2. Importaciones usando el Patrón Barril (Namespaces)
import * as AllStages from './index';
import * as AllFilters from './filter.operators';
import * as AllTransforms from './transform.operators';
import { AggregationFactory } from './interfaces/aggregation.factory';

// 3. Extraemos dinámicamente las clases de los namespaces
// Object.values() convierte las exportaciones en un array inyectable por NestJS
const STAGES = Object.values(AllStages);
const FILTERS = Object.values(AllFilters);
const TRANSFORMS = Object.values(AllTransforms);

@Global()
@Module({
    providers: [
        // 4. Registramos todas las clases extraídas para que NestJS las instancie
        ...STAGES,
        ...FILTERS,
        ...TRANSFORMS,

        // 5. Registramos los motores principales
        ExpressionEngine,
        PipelineOrchestrator,
        AggregationFactory,
        AggregationBuilder,
        QueryEngine, // 🌟 Registrado para que pueda ser inyectado en el Repositorio

        // 6. Inyectamos las instancias agrupadas bajo sus respectivos Tokens
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
        AggregationBuilder,
        AggregationFactory,
        QueryEngine // 🌟 Exportamos el QueryEngine para que SheetOdmModule lo consuma
    ]
})
export class PipelineModule { }