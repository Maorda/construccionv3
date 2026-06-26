import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class SheetOdmSerializeInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        // Atrapamos la respuesta del controlador y la pasamos por nuestro mutador
        return next.handle().pipe(
            map(data => this.serialize(data))
        );
    }

    /**
     * Función recursiva que limpia los datos antes de enviarlos.
     */
    private serialize(data: any): any {
        // 1. Manejo de nulos e indefinidos
        if (!data) return data;

        // 2. Si es un Array (ej: find() que devuelve varias entidades)
        if (Array.isArray(data)) {
            console.log("data en interceptor", data)
            return data.map(item => this.serialize(item));
        }

        // 3. Si es un Objeto
        if (typeof data === 'object') {
            // Evitamos tocar las fechas, ya que Date tiene su propio toJSON nativo
            if (data instanceof Date) {
                return data;
            }

            // 🚀 LA MAGIA: Si el objeto es una entidad de tu Model Factory y tiene toJSON()
            if (typeof data.toJSON === 'function') {
                return data.toJSON();
            }

            // Si es un objeto plano pero podría tener entidades anidadas
            // (ej: return { message: 'ok', data: obrero })
            const serializedObject: any = {};
            for (const key in data) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    serializedObject[key] = this.serialize(data[key]);
                }
            }
            return serializedObject;
        }

        // 4. Primitivos (strings, numbers, booleans)
        return data;
    }
}