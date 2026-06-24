export const CacheKeys = {
    /**
     * 📊 Clave para almacenar todos los registros crudos de una hoja.
     * Usada en: fetchRawData y getRawData
     */
    SHEET_DATA: (sheetName: string) => `sheet_data_${sheetName}`,

    /**
     * 🔍 Clave para una búsqueda indexada única (Read Gateway)
     * Usada cuando filtras por ID o columna única.
     */
    INDEXED_READ_SINGLE: (sheetName: string, column: string, value: string | number) =>
        `sheet_read_single_${sheetName}_${column}_${value}`,

    /**
     * 📚 Clave para búsquedas indexadas múltiples (Read Gateway)
     * Usada cuando filtras por una llave foránea o estado.
     */
    INDEXED_READ_MANY: (sheetName: string, column: string, value: string | number) =>
        `sheet_read_many_${sheetName}_${column}_${value}`,

    /**
     * ⚙️ Clave para la metadata compilada (Opcional)
     * Muy útil si en el futuro decides cachear los esquemas de las entidades
     * para no usar reflection en cada petición.
     */
    SCHEMA_METADATA: (entityName: string) => `schema_meta_${entityName}`,
};