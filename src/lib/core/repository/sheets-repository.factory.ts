import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { SheetsRepository } from './sheets.repository';
import { ClassType } from '../types/common.types';
import { RepositoryCoreFacade } from './repository-core.facade'; // 🚀 Importamos la Fachada Central

@Injectable()
export class SheetsRepositoryFactory {

    // El constructor queda completamente limpio. Ya no necesitas inyectar los 9 singletons uno por uno.
    constructor(
        private readonly moduleRef: ModuleRef
    ) { }

    /**
     * Fabrica dinámicamente un SheetsRepository ligado al Request actual.
     */
    async create<T extends object>(entityClass: ClassType<T>): Promise<SheetsRepository<T>> {

        // 🌟 LA MAGIA DEL CONSTESTO DINÁMICO:
        // En lugar de resolver el UnitOfWork por separado y arrastrar 9 singletons en el constructor,
        // resolvemos la Fachada Completa. NestJS inyectará el UnitOfWork correcto del request
        // dentro de este 'coreFacade' de manera limpia y segura.
        const coreFacade = await this.moduleRef.resolve(RepositoryCoreFacade);

        // Retornamos el repositorio ensamblado utilizando la nueva firma simplificada
        return new SheetsRepository<T>(entityClass, coreFacade);
    }
}