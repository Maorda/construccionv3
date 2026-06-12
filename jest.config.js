module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testRegex: '.*\\.spec\\.ts$',
    transform: {
        '^.+\\.(t|j)s$': ['ts-jest', {
            tsconfig: 'tsconfig.json',
            //isolatedModules: true,
        }],
    },
    moduleNameMapper: {
        '^@sheetOdm/(.*)$': '<rootDir>/src/lib/$1',
    },
    clearMocks: true,
    resetModules: true,
};