import { JoinEngine } from "./JoinEngine";
import { MetadataRegistry } from "./metadata.registry";
import { QueryOptions } from "../core/model/model.factory";
import { ClassType } from "../core/types/common.types";
import { JoinSheetTabsService } from "./JoinSheetTabsService";

export class QueryBuilder<T extends object> {
    private filter: any;
    private parentProjection: Record<string, number> = {};
    // Almacena proyecciones para relaciones: { adelantos: { monto: 1 } }
    private childProjections: Record<string, Record<string, number>> = {};
    private populatePaths: Set<string> = new Set();

    constructor(
        private repo: any,
        private entityClass: ClassType<T>,
        private joinSheetTabsService: JoinSheetTabsService, // 👈 Inyección del nuevo Orquestador
        private metadataRegistry: MetadataRegistry,
        filter: any
    ) {
        this.filter = filter;
    }
    /**
     * Soporta: .select('nombre dni') o .select('nombre Adelantos.monto')
     */
    select(fields: string | string[]): this {
        const fieldList = Array.isArray(fields)
            ? fields
            : fields.split(' ').map(f => f.trim()).filter(Boolean);

        for (const field of fieldList) {
            if (field.includes('.')) {
                // 🚀 PROYECCIÓN PROFUNDA: Es un campo de una relación
                const [relation, childProperty] = field.split('.');

                if (!this.childProjections[relation]) {
                    this.childProjections[relation] = {};
                }
                this.childProjections[relation][childProperty] = 1;

                // Si seleccionan una propiedad hija, auto-activamos el populate de esa relación
                this.populatePaths.add(relation);
            } else {
                // Proyección plana de la entidad actual
                this.parentProjection[field] = 1;
            }
        }
        return this;
    }

    populate(path: string | string[]): this {
        const paths = Array.isArray(path) ? path : [path];
        paths.forEach(p => this.populatePaths.add(p));
        return this;
    }

    async exec(): Promise<T[]> {
        const options: QueryOptions = {};

        if (Object.keys(this.parentProjection).length > 0) {
            if (this.populatePaths.size > 0) {
                const pk = this.metadataRegistry.getPrimaryKeyField(this.entityClass);
                this.parentProjection[pk] = 1;
            }
            options.projection = this.parentProjection;
        }

        // 1. Ejecutar consulta base en la pestaña padre
        const baseResults = await this.repo.find(this.filter, options);

        // 2. 🚀 DELEGACIÓN AL ORQUESTADOR
        return await this.joinSheetTabsService.orchestrate(
            baseResults,
            this.entityClass,
            this.populatePaths,
            this.childProjections
        );
    }

    then(onFulfilled: any, onRejected?: any) {
        return this.exec().then(onFulfilled, onRejected);
    }
}