export interface ColumnOptions {
    name?: string;
    type?: 'string' | 'number' | 'boolean' | 'date' | 'currency' | 'json' | 'array' | any;
    required?: boolean;
    default?: any;
    isDeleteControl?: boolean;
    isAutoIncrement?: boolean;
    generated?: 'uuid' | 'short-id' | 'increment';
    validation?: Record<string, any>;
    index?: boolean;
}