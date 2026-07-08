import { ClassType } from "../types/common.types";

export class RepositoryRegistry {
    private static repos = new Map<Function, any>();

    static register(entityClass: ClassType<any>, repoInstance: any): void {
        this.repos.set(entityClass, repoInstance);
    }

    static getRepo<T>(entityClass: ClassType<T>): any {
        const repo = this.repos.get(entityClass);
        if (!repo) {
            throw new Error(`[RepositoryRegistry] No se encontró un repositorio registrado para la entidad: ${entityClass.name}`);
        }
        return repo;
    }
}