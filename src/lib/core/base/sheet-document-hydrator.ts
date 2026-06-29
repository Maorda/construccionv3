import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { SheetsRepository } from "../repository/sheets.repository";

import { SheetDocument } from "../wrapper/sheet-document";
import { ClassType } from "../types/common.types";
import {
    ROW_INDEX_SYMBOL,
    SHEETS_COLUMN_DETAILS
} from '../../shared/constants/constants';
import { SheetDataTransformer } from "./sheetDataTransformer";

export interface HydratorOptions<T extends object, U extends SheetDocument<T>> {
    new?: boolean;
    oldDataFlat?: any;
    customConstructor?: new (
        data: T, // <-- Regresarlo a T
        repo: SheetsRepository<T>,
        isNew: boolean,
        entityClass?: ClassType<T>,
        rowNumber?: number,
        version?: number
    ) => U;
}

@Injectable()
export class SheetDocumentHydrator {
    private readonly logger = new Logger(SheetDocumentHydrator.name);

    constructor(
        private readonly transformer: SheetDataTransformer
    ) { }

    public hydrateAndShield<T extends object, U extends SheetDocument<T> = SheetDocument<T>>(
        entityClass: ClassType<T>,
        repository: SheetsRepository<T>,
        rawData: any,
        options: HydratorOptions<T, U> = {}
    ): U {
        if (!rawData) {
            throw new Error(`[Hydrator] No se pueden hidratar datos nulos para ${entityClass.name}`);
        }

        try {
            const dataToProcess = (options.new === false && options.oldDataFlat)
                ? options.oldDataFlat
                : rawData;

            const isNewDoc = options.new !== undefined
                ? options.new
                : (dataToProcess[ROW_INDEX_SYMBOL] === undefined);

            const targetPrototype = entityClass.prototype;
            const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, targetPrototype) || {};

            // 1. 🌟 LECTURA: De Google Sheets a Entidad TypeScript
            const processedData: Partial<T> = {};

            for (const key in details) {
                const config = details[key];
                const dbColumnName = config.name || key; // Busca la cabecera real (ej: ID_OBRERO)

                let value = dataToProcess[dbColumnName]; // 👈 CORRECCIÓN APLICADA AQUÍ

                if (config && config.type) {
                    value = this.transformer.castValue(value, config.type);
                }

                if (isNewDoc && (config as any)?.generated === 'uuid' && !value) {
                    value = randomUUID();
                }

                // Asigna a la propiedad de TS (ej: id, nombre)
                processedData[key as keyof T] = value !== undefined ? value : null as any;
            }

            const DynamicModel = options.customConstructor || class extends SheetDocument<T> {
                async save(): Promise<this> { return (await repository.save(this)) as this; }
                async remove(): Promise<boolean> { return await repository.delete(this); }
                async populate(path: string): Promise<this> { return this; }
            };

            const hydratedDoc = new DynamicModel(
                processedData as T,
                repository,
                isNewDoc,
                entityClass
            ) as U;

            (hydratedDoc as any)._entityClass = entityClass;

            if (dataToProcess[ROW_INDEX_SYMBOL] !== undefined) {
                (hydratedDoc as any)[ROW_INDEX_SYMBOL] = dataToProcess[ROW_INDEX_SYMBOL];
            }

            const descriptors = Object.getOwnPropertyDescriptors(targetPrototype);
            for (const [key, descriptor] of Object.entries(descriptors)) {
                if (descriptor.get && key !== 'constructor') {
                    Object.defineProperty(hydratedDoc, key, {
                        get: descriptor.get.bind(hydratedDoc),
                        enumerable: true,
                        configurable: true
                    });
                }
            }

            return hydratedDoc as U;

        } catch (error: any) {
            this.logger.error(`[Hydrator] ❌ Error crítico hidratando "${entityClass.name}": ${error.message}`);
            throw error;
        }
    }
}