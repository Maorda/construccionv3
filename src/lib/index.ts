// 1. Módulos principales (Lo que ya tienes)
export * from './sheetOdm.module';
export { DataSourceManager } from './core/data-source-manager';

// 2. Decoradores (Lo que el usuario usará diariamente para definir sus entidades)
// Debes exportar tus decoradores aquí para que los usen en sus clases
export * from './core/decorators/index'; // Asumiendo que tienes un index.ts en tu carpeta decorators

// 3. Tipos y Utilidades Globales (Aquí entra el ClassType que mencionamos)
export * from './core/types/common.types';

// 4. Interfaces de Configuración (Para que sepan cómo configurar @Column, etc.)
export * from './core/metadata/interfaces/index';

// 5. Servicios (Opcional, pero recomendado si necesitan acceder al MetadataRegistry)
export { MetadataRegistry } from './core/metadata/metadata.registry';