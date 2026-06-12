import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  constructor(

  ) {
    console.log('🚀 ¡Hola! El AppService ha sido inicializado correctamente.');
  }

  getHello(): string {
    return `✅ Conectado a la hoja:`;
  }
}