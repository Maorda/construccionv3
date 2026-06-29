import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class SheetOdmSerializeInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle().pipe(
            map(data => this.serialize(data))
        );
    }

    private serialize(data: any): any {
        if (!data) return data;

        if (Array.isArray(data)) {
            return data.map(item => this.serialize(item));
        }

        if (typeof data === 'object') {
            if (data instanceof Date) {
                return data;
            }

            // 🚀 LA MAGIA: Extraemos el JSON crudo de la entidad
            if (typeof data.toJSON === 'function') {
                const rawJson = data.toJSON();
                // 🔄 Volvemos a serializar el resultado por si hay entidades anidadas (Ej: Subcolecciones)
                return this.serialize(rawJson);
            }

            const serializedObject: any = {};
            for (const key in data) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    serializedObject[key] = this.serialize(data[key]);
                }
            }
            return serializedObject;
        }

        return data;
    }
}