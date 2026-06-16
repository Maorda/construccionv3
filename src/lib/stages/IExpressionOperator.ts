export interface IExpressionOperator {
    readonly name: string;
    readonly schema?: string[]; // 🟢 Permite tipar los argumentos por posición dinámicamente
    exec(args: any, record: any, engine: any): any;
}