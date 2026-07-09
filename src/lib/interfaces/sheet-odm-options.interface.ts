// src/lib/interfaces/sheet-odm-options.interface.ts
import { ModuleMetadata, Type } from '@nestjs/common';


export class GoogleDriveConfig {
    type!: string;
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

export const CONNECTION_STABILITY = {
    STABLE: 1500,     // Conexión óptima
    UNSTABLE: 3000,   // Conexión promedio/oscilante
    CRITICAL: 5000    // Conexión muy lenta (Satélite/Radio)
};

export class PostgresConfig {
    host!: string;
    port!: number;
    username!: string;
    password?: string;
    database!: string;
    ssl?: boolean;
}

// 🟢 SOLUCIÓN: Al ser una clase abstracta, esbuild la empaqueta de forma nativa como código JS real
export abstract class SheetOdmModuleOptions {
    outboxRetentionInterval?: string;
    googleDriveConfig!: GoogleDriveConfig;
    googleDriveBaseFolderId!: string;
    spreadsheetId?: string;
    checkConnectionOnBoot?: boolean;
    webAppUrl!: string;
    apiKey!: string;
    timeout?: number;
    timezone?: string;
    formatDates?: boolean;
    outboxPollingInterval?: number;
    postgres!: PostgresConfig;
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
