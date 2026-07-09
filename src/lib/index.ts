// ============================================================================
// @sheetodm/core - Punto de Entrada Principal (NPM Public API)
// ============================================================================

// 1. Módulo Principal de NestJS
export * from './sheetOdm.module';
export { DataSourceManager } from './core/data-source-manager';

// 2. Opciones de Configuración y Clases de Contrato
export * from './interfaces/sheet-odm-options.interface';
export * from './interfaces/provider.interface';

// 3. Decoradores del ODM (Lo que el desarrollador usa en sus clases/entidades)
export * from './core/decorators/index';

// 4. Tipos, Constantes y Utilidades Globales
export * from './core/types/common.types';
export * from './shared/constants/constants';

// 5. Interfaces de Metadatos (Tipados para configuración interna de columnas, etc.)
export * from './core/metadata/interfaces/index';

// 6. Servicios Auxiliares Exponibles para el Usuario Final
export { MetadataRegistry } from './JoinSheetTabs/metadata.registry';
export { RepositoryCoreFacade } from './core/repository/repository-core.facade';
export { SheetsRepository } from './core/repository/sheets.repository';