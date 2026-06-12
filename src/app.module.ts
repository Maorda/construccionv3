// src/app.module.ts
import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { SheetOdmModule } from '@sheetOdm/sheetOdm.module';
import { AppController } from './app.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
// IMPORTANTE: Aquí estamos consumiendo la  

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        // Aquí inicializamos tu librería
        SheetOdmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                googleDriveConfig: {
                    type: 'service_account',
                    project_id: config.get<string>('GOOGLE_PROJECT_ID')!,
                    private_key_id: config.get<string>('GOOGLE_PRIVATE_KEY_ID')!,
                    private_key: (config.get<string>('GOOGLE_PRIVATE_KEY') || '').replace(/\\n/g, '\n'),
                    client_email: config.get<string>('GOOGLE_CLIENT_EMAIL')!,
                    client_id: config.get<string>('GOOGLE_CLIENT_ID')!,
                    auth_uri: config.get<string>('GOOGLE_AUTH_URI')!,
                    token_uri: config.get<string>('GOOGLE_TOKEN_URI')!,
                    auth_provider_x509_cert_url: config.get<string>('GOOGLE_AUTH_PROVIDER_X509_CERT_URL')!,
                    client_x509_cert_url: config.get<string>('GOOGLE_CLIENT_X509_CERT_URL')!,
                },
                googleDriveBaseFolderId: config.get<string>('GOOGLE_FOLDER_ID')!,
                SPREADSHEET_ID: config.get<string>('SPREADSHEET_ID')!,
                checkConnectionOnBoot: true,
                timezone: config.get<string>('TIMEZONE') || 'UTC',//'America/Lima configurado en el .env',
                FORMAT_DATES: config.get<boolean>('FORMAT_DATES') || false, //configurado en el .env
                //timeout: CONNECTION_STABILITY.UNSTABLE,
                outboxPollingInterval: 10000,
                // Aquí mapeas asíncronamente los datos de tu servidor Postgres
                postgres: {
                    host: config.get<string>('DB_HOST')!, // El '!' le dice a TS: "Confía en mí, no será undefined"
                    port: config.get<number>('DB_PORT') || 6543,
                    username: config.get<string>('DB_USERNAME')!,
                    password: config.get<string>('DB_PASSWORD') || '',
                    database: config.get<string>('DB_NAME')!,
                    ssl: config.get<boolean>('DB_SSL') || false,
                },


            }),
        }),
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule { }