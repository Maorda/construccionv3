import { QueryOptions } from "../model/model.factory";

export class QueryBuilder<T> {
    private filter: any;
    private projection: any = {};
    private populatePaths: string[] = [];

    constructor(private repo: any, filter: any) {
        this.filter = filter;
    }

    select(path: string): this {
        // Soporta 'monto' o 'Adelantos.monto'
        // Si es 'Adelantos.monto', esto requiere una lógica de proyección profunda
        this.projection[path] = 1;
        return this;
    }

    populate(path: string): this {
        this.populatePaths.push(path);
        return this;
    }

    async exec(): Promise<T[]> {
        // Aquí consolidamos todas las opciones acumuladas
        const options: QueryOptions = {
            projection: this.projection,
            populate: this.populatePaths
        };

        // Ejecutamos en el repositorio
        return await this.repo.find(this.filter, options);
    }

    // Para que funcione el 'await query' sin llamar a .exec()
    then(onFulfilled: any, onRejected: any) {
        return this.exec().then(onFulfilled, onRejected);
    }
}