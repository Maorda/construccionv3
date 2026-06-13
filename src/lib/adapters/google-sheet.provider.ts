import { Inject, Injectable } from '@nestjs/common';
import { GoogleDriveConfig, SheetOdmModuleOptions } from '../interfaces/sheet-odm-options.interface';
import { google } from 'googleapis';
import { sheets_v4, drive_v3 } from 'googleapis';
import { SHEET_ODM_OPTIONS } from '@sheetOdm/shared/constants/constants';

@Injectable()
export class GoogleSheetProvider {
    private _sheets: any;
    private _drive: any;

    constructor(
        @Inject(SHEET_ODM_OPTIONS) private config: SheetOdmModuleOptions,
    ) {
        if (!this.config) {
            console.error("❌ GoogleAuthProvider: 'CONFIG' es undefined en el constructor");
        }
    }

    // Usamos un Getter para inicialización bajo demanda (lazy-loading)
    get sheets() {
        if (!this._sheets) {
            this.initialize();
        }
        return this._sheets;
    }

    get drive() {
        if (!this._drive) {
            this.initialize();
        }
        return this._drive;
    }

    private initialize() {
        // Extraemos de forma segura el sub-objeto de credenciales
        const googleConfig = this.config.googleDriveConfig;

        if (!googleConfig || !googleConfig.client_email) {
            throw new Error(
                "Configuración de Google no cargada en googleDriveConfig. Verifica tu .env o AppModule."
            );
        }

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: googleConfig.client_email,
                private_key: googleConfig.private_key,
            },
            scopes: [
                'https://www.googleapis.com/auth/drive',
                'https://www.googleapis.com/auth/drive.file',
                'https://www.googleapis.com/auth/drive.readonly',
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/spreadsheets.readonly',
                'https://www.googleapis.com/auth/drive.metadata.readonly'
            ],
        });

        this._drive = google.drive({ version: 'v3', auth });
        this._sheets = google.sheets({ version: 'v4', auth });
    }
}