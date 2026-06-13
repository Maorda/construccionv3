// src/lib/core/uow/decorators/transactional.decorator.ts
import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { GasTelemetryInterceptor } from '../../interceptors/gas-telemetry.interceptor';
import { TransactionInterceptor } from '../interceptors/transaction.interceptor';

export function Transactional() {
    return applyDecorators(
        UseInterceptors(GasTelemetryInterceptor, TransactionInterceptor)
    );
}