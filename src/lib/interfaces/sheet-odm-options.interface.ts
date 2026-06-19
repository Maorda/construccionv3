// src/lib/interfaces/sheet-odm-options.interface.ts
import { ModuleMetadata, Type } from '@nestjs/common';

export interface GoogleDriveConfig {
    type: string;
    project_id?: string;
    private_key_id?: string;
    private_key?: string;
    client_email?: string;
    client_id?: string;
    auth_uri?: string;
    token_uri?: string;
    auth_provider_x509_cert_url?: string;
    client_x509_cert_url?: string;
    universe_domain?: string;
}

// Tiempos de estabilidad basados en realidades de red complejas
export const CONNECTION_STABILITY = {
    STABLE: 1500,     // Conexión óptima
    UNSTABLE: 3000,   // Conexión promedio/oscilante
    CRITICAL: 5000    // Conexión muy lenta (Satélite/Radio)
};

export interface SheetOdmModuleOptions {

    // Nueva propiedad: Acepta formatos nativos de Postgres como '2 hours', '1 day', '30 minutes'
    outboxRetentionInterval?: string;
    /** Configuración completa del Service Account de Google (JSON) */
    googleDriveConfig: GoogleDriveConfig;

    /** ID de la carpeta raíz en Drive donde se gestionan los archivos */
    googleDriveBaseFolderId: string;

    /** ID del Spreadsheet principal por defecto */
    spreadsheetId?: string;

    /** Si es true, el HealthCheck se ejecuta al arrancar */
    checkConnectionOnBoot?: boolean;

    /** Tiempo de espera máximo para respuestas de la API de Google (ms) */
    timeout?: number;

    timezone?: string; // Ejemplo: 'America/Lima'
    formatDates?: boolean;
    outboxPollingInterval?: number;

    /** * Configuración de conexión para PostgreSQL 
     * (La agregamos aquí para que forRoot configure ambos mundos a la vez)
     */
    postgres: {
        host: string;
        port: number;
        username: string;
        password?: string;
        database: string;
        ssl?: boolean;
    };
}

export interface SheetOdmModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
    useFactory?: (...args: any[]) => Promise<SheetOdmModuleOptions> | SheetOdmModuleOptions;
    inject?: any[];
    useClass?: Type<SheetOdmModuleOptionsFactory>;
    useExisting?: Type<SheetOdmModuleOptionsFactory>;
}

export interface SheetOdmModuleOptionsFactory {
    createSheetOdmOptions(): Promise<SheetOdmModuleOptions> | SheetOdmModuleOptions;
}