import { Inject, Injectable } from '@nestjs/common';
import { GoogleDriveConfig } from '../interfaces/sheet-odm-options.interface';
import { google } from 'googleapis';
import { sheets_v4, drive_v3 } from 'googleapis';

@Injectable()
export class GoogleSheetProvider {
    private _sheets: any;
    private _drive: any;

    constructor(
        @Inject('CONFIG') private config: GoogleDriveConfig,
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
        if (!this.config || !this.config.client_email) {
            throw new Error(
                "Configuración de Google no cargada. Verifica que 'DATABASE_OPTIONS' o 'CONFIG' se estén pasando correctamente en el Module."
            );
        }

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: this.config.client_email,
                private_key: this.config.private_key,
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