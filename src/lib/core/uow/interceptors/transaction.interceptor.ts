// src/lib/core/uow/interceptors/transaction.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Scope } from '@nestjs/common';
import { Observable, catchError, throwError, concatMap } from 'rxjs';
import { UnitOfWork } from '../services/unit-of-work.service';


@Injectable({ scope: Scope.REQUEST })
export class TransactionInterceptor implements NestInterceptor {
    constructor(private readonly uow: UnitOfWork) { }

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
        this.uow.startTransaction();

        return next.handle().pipe(
            // concatMap espera a que la promesa se resuelva antes de continuar
            concatMap(async (data) => {
                await this.uow.commit();
                return data; // Devuelve la respuesta original del controlador al cliente
            }),
            catchError((err) => {
                this.uow.rollback();
                return throwError(() => err);
            })
        );
    }
}