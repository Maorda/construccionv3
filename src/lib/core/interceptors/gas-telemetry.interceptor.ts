import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class GasTelemetryInterceptor implements NestInterceptor {
    private readonly logger = new Logger('GAS_Telemetry');

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const startTime = Date.now();

        // Obtenemos los detalles de la petición HTTP actual
        const request = context.switchToHttp().getRequest();
        const { method, url, query, params } = request;

        return next.handle().pipe(
            tap({
                next: () => {
                    const duration = Date.now() - startTime;
                    this.logger.log(
                        `[SUCCESS] ${method} ${url} | Duración: ${duration}ms | Params: ${JSON.stringify(params)} | Query: ${JSON.stringify(query)}`,
                    );
                },
                error: (error) => {
                    const duration = Date.now() - startTime;
                    this.logger.error(
                        `[FAILED] ${method} ${url} | Duración: ${duration}ms | Error: ${error.message}`,
                    );
                },
            }),
        );
    }
}