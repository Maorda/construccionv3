export interface ReferenceOptions {
    joinColumn: string;
    required?: boolean;
    onDelete?: 'CASCADE' | 'SET_NULL' | 'RESTRICT';
}

export interface SubCollectionOptions {
    onDelete?: 'CASCADE' | 'SET_NULL' | 'RESTRICT';
    joinColumn?: string;
    localField?: string;

}