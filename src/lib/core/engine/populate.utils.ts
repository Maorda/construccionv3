export interface PopulateTree {
    [key: string]: PopulateTree;
}

export function buildPopulateTree(paths: string[]): PopulateTree {
    const root: PopulateTree = {};

    for (const path of paths) {
        const parts = path.split('.');
        let current = root;

        for (const part of parts) {
            if (!current[part]) {
                current[part] = {};
            }
            current = current[part];
        }
    }

    return root;
}
// Ejemplo de salida para ['albums.fotos', 'albums.tracks']:
// { albums: { fotos: {}, tracks: {} } }