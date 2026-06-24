export const configLoader = () => {
    return {
        GAS_WEBAPP_URL: process.env['GAS_WEBAPP_URL'],
        GAS_API_KEY: process.env['GAS_API_KEY']
    }
}