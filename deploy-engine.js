const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

async function deploy() {
    // 1. Cargar el JSON de credenciales (Service Account)
    const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/script.projects']
    });

    const drive = google.drive({ version: 'v3', auth });
    const script = google.script({ version: 'v1', auth });

    console.log("🚀 Iniciando despliegue de @sheetodm/core...");

    // 2. Crear el archivo en Google Drive
    const file = await drive.files.create({
        requestBody: {
            name: 'SheetODM_Engine',
            mimeType: 'application/vnd.google-apps.script',
        }
    });
    const scriptId = file.data.id;
    console.log(`✅ Proyecto creado. ID: ${scriptId}`);

    // 3. Preparar el contenido (Tu código ofuscado + Manifest)
    const code = fs.readFileSync(path.join(__dirname, '../dist/gas-engine.obfuscated.js'), 'utf8');
    const manifest = fs.readFileSync(path.join(__dirname, '../src/gas/appsscript.json'), 'utf8');

    // 4. Inyectar el código
    await script.projects.updateContent({
        scriptId: scriptId,
        requestBody: {
            files: [
                { name: 'appsscript', type: 'JSON', source: manifest },
                { name: 'Engine', type: 'SERVER_JS', source: code }
            ]
        }
    });

    console.log("🎉 Despliegue completado con éxito.");
    console.log(`Copia este ID en tu variable de entorno GAS_SCRIPT_ID: ${scriptId}`);
}

deploy().catch(console.error);