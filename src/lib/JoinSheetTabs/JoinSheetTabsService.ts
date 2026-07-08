import { Injectable, Logger } from '@nestjs/common';
import { JoinEngine } from './JoinEngine';
import { ClassType } from '../core/types/common.types';
import { PopulateOptions, QueryOptions } from '../core/model/model.factory';

@Injectable()
export class JoinSheetTabsService {
    private readonly logger = new Logger(JoinSheetTabsService.name);

    constructor(private readonly joinEngine: JoinEngine) { }

    /**
     * 🚀 NUEVO: Método puente adaptador para el SheetsRepository.
     * Extrae de forma segura los paths y las proyecciones desde las opciones de consulta
     * y los convierte al formato estricto que requiere tu JoinEngine.
     */
    async resolveJoins<T extends object, U extends object = any>(
        results: U[],
        entityClass: ClassType<T>,
        options?: QueryOptions<T>
    ): Promise<U[]> {
        if (!results || results.length === 0 || !options?.populate) {
            return results;
        }

        const populatePaths = new Set<string>();
        const childProjections: Record<string, Record<string, number>> = {};

        // 🔍 MAPEADOR FINO: Normalizamos la entrada a un array para iterar con precisión
        const rawPopulateList = Array.isArray(options.populate) ? options.populate : [options.populate];

        for (const item of rawPopulateList) {
            if (typeof item === 'string') {
                // Caso 1: populate: 'adelantos' o populate: ['adelantos', 'herramientas']
                populatePaths.add(item);
            } else if (item && typeof item === 'object' && 'path' in item) {
                // Caso 2: PopulateOptions -> { path: 'adelantos', select: { monto: 1 } }
                const popOpt = item as PopulateOptions;
                populatePaths.add(popOpt.path);

                if (popOpt.select) {
                    childProjections[popOpt.path] = this.normalizeProjection(popOpt.select);
                }
            }
        }

        if (populatePaths.size === 0) {
            return results;
        }

        return this.orchestrate(results as any[], entityClass, populatePaths, childProjections) as unknown as Promise<U[]>;
    }

    /**
     * 🚀 NUEVO: Método hook para interceptar borrados en cascada desde el repositorio.
     * De momento queda declarado de forma segura para evitar fallos de ejecución (no-op).
     */
    async handleCascadeDelete<T extends object, U extends object = any>(
        doc: U,
        entityClass: ClassType<T>
    ): Promise<void> {
        this.logger.debug(`[CascadeDelete] Procesando entidad ${entityClass.name}`);
        // Tu lógica futura de cascada aquí
    }
    private normalizeProjection(select: string | string[] | Record<string, any>): Record<string, number> {
        if (typeof select === 'object' && !Array.isArray(select)) {
            const result: Record<string, number> = {};
            for (const key of Object.keys(select)) {
                result[key] = select[key] ? 1 : 0;
            }
            return result;
        }

        const fields = Array.isArray(select) ? select : select.split(' ');
        const projection: Record<string, number> = {};
        for (const field of fields) {
            const cleanField = field.trim();
            if (cleanField) projection[cleanField] = 1;
        }
        return projection;
    }

    /**
     * Coordina y ejecuta en lotes (batch) todos los joins solicitados para una consulta.
     * 🔥 TU MÉTODO ORIGINAL INTACTO 🔥
     */
    async orchestrate<T extends object>(
        results: T[],
        entityClass: ClassType<T>,
        populatePaths: Set<string>,
        childProjections: Record<string, Record<string, number>>
    ): Promise<T[]> {
        // Early return si no hay registros o no se solicitaron relaciones
        if (!results || results.length === 0 || populatePaths.size === 0) {
            return results;
        }

        let orchestratedResults = [...results];

        this.logger.log(`🚀 [JoinSheetTabs] Iniciando orquestación de ${populatePaths.size} relación(es) para ${entityClass.name}`);

        for (const propertyName of populatePaths) {
            try {
                // Aseguramos que childProj no sea undefined para evitar que rompa tu JoinEngine
                const childProj = childProjections[propertyName] || {};

                // Ejecutamos el Join Engine de forma secuencial y segura
                orchestratedResults = await this.joinEngine.execute(
                    orchestratedResults,
                    entityClass,
                    propertyName,
                    childProj
                );
            } catch (error: any) {
                this.logger.error(
                    `❌ [JoinSheetTabs] Error crítico al orquestar la relación '${propertyName}' en ${entityClass.name}. Detalle: ${error.message}`,
                    error.stack
                );
                // Lanzamos el error en producción para evitar que la app consuma datos parcialmente corruptos o vacíos
                throw new Error(`[JoinSheetTabsModule] Failed to populate relation '${propertyName}': ${error.message}`);
            }
        }

        return orchestratedResults;
    }
}