// src/app.module.ts
import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { AppService } from './app.service';
import { SheetOdmModule } from './lib/sheetOdm.module';
import { AppController } from './app.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { InfrastructureProvisioner } from './lib/infrastructure/InfrastructureProvisioner';
import { TestInfrastructureModule } from './client/cliente.module';
import { OutboxModule } from '@sheetOdm/core/outbox/outbox.module';
import { configLoader } from '../configLoader';
import { envValidationSchema } from '../env.validation';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configLoader],                  // Carga tus variables personalizadas
            validationSchema: envValidationSchema, // 🛡️ Bloquea el arranque si falta algo del .env
            validationOptions: {
                allowUnknown: true, // Permite que existan otras variables en el .env sin que Joi lance error
                abortEarly: false,  // Muestra TODOS los errores a la vez, no solo el primero
            }
        }),

        SheetOdmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                googleDriveConfig: {
                    type: 'service_account',
                    project_id: config.get<string>('GOOGLE_PROJECT_ID')!,
                    private_key_id: config.get<string>('GOOGLE_PRIVATE_KEY_ID')!,
                    // Reemplaza correctamente los saltos de línea de la clave privada
                    private_key: (config.get<string>('GOOGLE_PRIVATE_KEY') || '').replace(/\\n/g, '\n'),
                    client_email: config.get<string>('GOOGLE_CLIENT_EMAIL')!,
                    client_id: config.get<string>('GOOGLE_CLIENT_ID')!,
                    auth_uri: config.get<string>('GOOGLE_AUTH_URI')!,
                    token_uri: config.get<string>('GOOGLE_TOKEN_URI')!,
                    auth_provider_x509_cert_url: config.get<string>('GOOGLE_AUTH_PROVIDER_X509_CERT_URL')!,
                    client_x509_cert_url: config.get<string>('GOOGLE_CLIENT_X509_CERT_URL')!,
                },
                googleDriveBaseFolderId: config.get<string>('GOOGLE_FOLDER_ID')!,
                spreadsheetId: config.get<string>('SPREADSHEET_ID')!, // ✅ Corregido a camelCase
                webAppUrl: config.get<string>('GAS_WEBAPP_URL')!,
                apiKey: config.get<string>('GAS_API_KEY')!,
                checkConnectionOnBoot: true,
                timezone: config.get<string>('TIMEZONE') || 'UTC',
                formatDates: config.get<boolean>('FORMAT_DATES') || false, // ✅ Corregido a camelCase
                outboxPollingInterval: 10000, // Cada 10 segundos busca tareas
                outboxRetentionInterval: '2 hours', // ✅¡Configuración dinámica! Puede ser '30 minutes', '12 hours', '2 days', tiempo que se quedan en la tabla outbox-entries
                postgres: {
                    host: config.get<string>('DB_HOST')!,
                    port: config.get<number>('DB_PORT') || 6543,
                    username: config.get<string>('DB_USERNAME')!,
                    password: config.get<string>('DB_PASSWORD') || '',
                    database: config.get<string>('DB_NAME')!,
                    ssl: config.get<boolean>('DB_SSL') || false,
                },
            }),
        }),
        TestInfrastructureModule,
        OutboxModule

    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule { }