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
        data: T,
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
            // 1. Determinar fuente de datos
            const dataToProcess = (options.new === false && options.oldDataFlat)
                ? options.oldDataFlat
                : rawData;

            const isNewDoc = options.new !== undefined
                ? options.new
                : (dataToProcess[ROW_INDEX_SYMBOL] === undefined);

            // 2. Extraer metadatos
            const targetPrototype = entityClass.prototype;
            const details = Reflect.getMetadata(SHEETS_COLUMN_DETAILS, targetPrototype) || {};

            // 3. 🌟 PROCESO DE TRANSFORMACIÓN (Casteo de tipos centralizado)
            // Aquí consumimos nuestro Transformer en lugar de tener lógica dispersa
            const processedData = { ...dataToProcess };
            for (const key in details) {
                const config = details[key];
                if (config && config.type) {
                    processedData[key] = this.transformer.castValue(
                        dataToProcess[key],
                        config.type
                    );
                }
            }

            // 4. Instanciar y asignar datos limpios
            const instance = new entityClass();
            Object.assign(instance, processedData);

            // Preservar puntero de fila
            if (dataToProcess[ROW_INDEX_SYMBOL] !== undefined) {
                (instance as any)[ROW_INDEX_SYMBOL] = dataToProcess[ROW_INDEX_SYMBOL];
            }

            // 5. 🔑 AUTO-GENERACIÓN (Solo si es documento nuevo)
            if (isNewDoc) {
                for (const [propName, config] of Object.entries(details)) {
                    if ((config as any)?.generated === 'uuid' && !instance[propName as keyof T]) {
                        (instance as any)[propName] = randomUUID();
                    }
                }
            }

            // 6. 🔄 INSTANCIACIÓN DEL WRAPPER
            const DynamicModel = options.customConstructor || class extends SheetDocument<T> {
                async save(): Promise<this> { return (await repository.save(this)) as this; }
                async remove(): Promise<boolean> { return await repository.delete(this); }
                async populate(path: string): Promise<this> { return this; }
            };

            const hydratedDoc = new DynamicModel(
                instance as T,
                repository,
                isNewDoc,
                entityClass
            ) as U;

            (hydratedDoc as any)._entityClass = entityClass;

            // 7. 📈 VIRTUAL GETTERS (Binding)
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

            // 8. 🛡️ SERIALIZADOR TOTAL (toJSON)
            Object.defineProperty(hydratedDoc, 'toJSON', {
                value: function () {
                    const plainObject = {} as any;
                    for (const col of Object.keys(details)) {
                        plainObject[col] = this[col] !== undefined ? this[col] : null;
                    }
                    // Incluir virtuals definidos en el prototype
                    for (const key of Object.keys(descriptors)) {
                        if (descriptors[key].get && key !== 'constructor') {
                            plainObject[key] = this[key];
                        }
                    }
                    const rowIndex = this[ROW_INDEX_SYMBOL];
                    if (rowIndex !== undefined) plainObject.__row = rowIndex;
                    return plainObject;
                },
                enumerable: false,
                configurable: true
            });

            return hydratedDoc as U;

        } catch (error: any) {
            this.logger.error(`[Hydrator] ❌ Error crítico hidratando "${entityClass.name}": ${error.message}`);
            throw error;
        }
    }
}