import { Injectable } from '@nestjs/common';
import { AggregationBuilder } from '../aggregation.builder';
import { PipelineOrchestrator } from '../pipeline.registry';

@Injectable()
export class AggregationFactory {
    constructor(private readonly orchestrator: PipelineOrchestrator) { }

    /**
     * Crea una instancia fresca de AggregationBuilder.
     * Al usar ModuleRef, garantizamos que NestJS gestione el ciclo de vida TRANSIENT correctamente.
     */
    create(): AggregationBuilder {
        return new AggregationBuilder(this.orchestrator);
    }
}