import { Injectable, Logger } from '@nestjs/common';
import { SheetDataGateway } from './sheet-api/sheet-data.gateway';
import { MetadataRegistry } from '../core/metadata/metadata.registry';
import { SHEETS_DTO, SHEETS_TABLE_NAME } from '../shared/constants/constants';
import { ClassType } from '../core/types/common.types';

@Injectable()
export class InfrastructureProvisioner {
    private readonly logger = new Logger(InfrastructureProvisioner.name);

    constructor(
        private readonly gateway: SheetDataGateway,
        private readonly registry: MetadataRegistry,
    ) { }

    /**
     * Sincroniza de forma óptima el esquema local (Entidades) con Google Sheets
     */
    async syncSchema(): Promise<void> {
        const entities = MetadataRegistry.getAllRegisteredEntities();
        if (!entities || entities.length === 0) {
            this.logger.warn('⚠️ No se encontraron entidades registradas en el MetadataRegistry.');
            return;
        }

        // 🚀 OPTIMIZACIÓN: Traemos los títulos UNA sola vez para todo el proceso
        const existingSheets = await this.gateway.getExistingSheetTitles();
        const existingSheetsUpper = new Set(existingSheets.map(s => s.toUpperCase()));

        const archiveConfig: Record<string, string> = {};

        for (const entity of entities) {
            const dto = Reflect.getMetadata(SHEETS_DTO, entity);
            if (!dto) {
                throw new Error(`❌ [ODM Error] La entidad ${entity.name} no tiene un DTO vinculado. Define { dto: TuDto } en @Table.`);
            }

            // 1. Validar consistencia estructural código vs tipos
            this.validateSchemaConsistency(entity, dto);

            const sheetName = (Reflect.getMetadata(SHEETS_TABLE_NAME, entity) || entity.name).toUpperCase();
            archiveConfig[sheetName] = `${sheetName}_HISTORICO`;

            const definedHeaders = this.getHeadersForEntity(entity);
            const sheetExists = existingSheetsUpper.has(sheetName);

            if (!sheetExists) {
                await this.provisionNewSheet(sheetName, definedHeaders);
                // Evitamos que verificaciones posteriores de dependencias fallen simulando que ya existe
                existingSheetsUpper.add(sheetName);
            } else {
                await this.migrateExistingSheet(sheetName, definedHeaders);
            }
        }

        // 🚀 OPTIMIZACIÓN: Pasamos el listado existente para no volver a consultar la API de Google
        await this.syncConfigSheet(archiveConfig, existingSheetsUpper);
    }

    private async syncConfigSheet(config: Record<string, string>, existingSheetsUpper: Set<string>) {
        const configSheetName = '_CONFIG';

        if (!existingSheetsUpper.has(configSheetName)) {
            await this.gateway.createSheet(configSheetName);
        }

        await this.gateway.writeHeaders(configSheetName, ['CONFIG_JSON']);
        await this.gateway.updateRow(configSheetName, 2, [JSON.stringify(config)]);

        this.logger.log(`✅ Configuración de archivado escrita en la hoja "${configSheetName}".`);
    }

    private async provisionNewSheet(sheetName: string, headers: string[]) {
        this.logger.log(`📡 Creando pestaña nueva: "${sheetName}"`);
        await this.gateway.createSheet(sheetName);
        await this.gateway.writeHeaders(sheetName, headers);
        this.logger.log(`✅ Pestaña "${sheetName}" creada con cabeceras: [${headers.join(', ')}]`);
    }

    // 🔥 MEJORA CRÍTICA: Migración inteligente In-Place para Asteriscos de Índices
    private async migrateExistingSheet(sheetName: string, definedHeaders: string[]) {
        const actualRows = await this.gateway.getRange(`${sheetName}!1:1`);

        // Control de daños si la hoja está completamente vacía
        const currentHeaders = actualRows && actualRows[0]
            ? actualRows[0].map((h: any) => String(h).trim())
            : [];

        // Helper para limpiar asteriscos y espacios (Garantiza comparaciones limpias)
        const cleanHeader = (h: string) => h.replace(/\*$/, '').trim().toUpperCase();

        // Mapeo rápido de lo que el desarrollador ha declarado en el código [NombreLimpio -> NombreConOWithoutAsterisk]
        const definedHeadersMap = new Map<string, string>();
        definedHeaders.forEach(h => definedHeadersMap.set(cleanHeader(h), h));

        const currentHeadersCleanSet = new Set(currentHeaders.map(cleanHeader));
        let hasChanges = false;

        // 1. Sincronizar en su misma posición las cabeceras existentes (Control de mutación de asteriscos)
        const updatedCurrentHeaders = currentHeaders.map(current => {
            const cleanCurrent = cleanHeader(current);
            const matchedDefined = definedHeadersMap.get(cleanCurrent);

            if (matchedDefined) {
                // Si el formato cambió (ej: de "DNI" a "DNI*" o viceversa), marcamos actualización
                if (current !== matchedDefined) {
                    hasChanges = true;
                }
                return matchedDefined;
            }
            // Si la columna está en Sheets pero no en el código, se conserva intacta (tolerancia a columnas manuales)
            return current;
        });

        // 2. Identificar columnas completamente nuevas añadidas en el código
        const missingHeaders = definedHeaders.filter(h => !currentHeadersCleanSet.has(cleanHeader(h)));

        if (missingHeaders.length > 0) {
            hasChanges = true;
        }

        // 3. Persistir en Google Sheets únicamente si hubo cambios estructurales o de indexación
        if (hasChanges) {
            const finalHeaders = [...updatedCurrentHeaders, ...missingHeaders];
            this.logger.log(`🔄 Sincronizando índices/columnas en "${sheetName}"...`);

            if (missingHeaders.length > 0) {
                this.logger.log(`➕ Nuevas columnas acopladas al final: [${missingHeaders.join(', ')}]`);
            }

            await this.gateway.writeHeaders(sheetName, finalHeaders);
            this.logger.log(`✅ Estructura e índices de "${sheetName}" actualizados sin alterar el orden de los datos.`);
        }
    }

    private validateSchemaConsistency(entity: ClassType, dto: ClassType) {
        const colDetails = this.registry.getColumnDetails(entity);
        const entityFields = Object.keys(colDetails);
        const dtoInstance = new (dto as any)();

        const dtoFields = new Set([
            ...Object.getOwnPropertyNames(dtoInstance),
            ...Object.getOwnPropertyNames(dto.prototype)
        ]);

        for (const field of entityFields) {
            if (field === 'constructor') continue;

            const dtoFieldType = Reflect.getMetadata('design:type', dto.prototype, field);

            if (!dtoFields.has(field) && !dtoFieldType) {
                throw new Error(
                    `❌ [ODM Error] La entidad '${entity.name}' define la columna '${field}', ` +
                    `pero no existe o no está inicializada en el DTO '${dto.name}'.`
                );
            }

            const entityColumnType = colDetails[field].type;

            if (entityColumnType && dtoFieldType) {
                const dtoTypeName = dtoFieldType.name.toLowerCase();
                if (entityColumnType !== dtoTypeName) {
                    throw new Error(
                        `❌ [ODM Error] Inconsistencia en '${field}'. DTO '${dto.name}' espera tipo '${dtoTypeName}', pero la Entidad define '${entityColumnType}'.`
                    );
                }
            }
        }
    }

    // 🔥 REFACTORIZACIÓN CORE: Inyección dinámica del Asterisco basado en los metadatos del decorador
    private getHeadersForEntity(entity: ClassType): string[] {
        const colDetails = this.registry.getColumnDetails(entity);
        const colMap = this.registry.getColumnMap(entity);

        return Object.entries(colMap)
            .sort(([, a], [, b]) => a - b)
            .map(([propName]) => {
                const colConfig = colDetails[propName];
                const baseName = (colConfig?.name ? colConfig.name : propName).toUpperCase();

                // 🚀 Si el desarrollador configuró index: true, le inyectamos el asterisco de forma transparente
                // Nota: Asegúrate de que tu interfaz 'ColumnOptions' acepte la propiedad 'index?: boolean'
                return colConfig?.index ? `${baseName}*` : baseName;
            });
    }
}