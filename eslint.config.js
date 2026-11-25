import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['dist/', 'node_modules/', '.agents/', '.impeccable/', '.playwright-mcp/', 'dev-dist/'] },
    js.configs.recommended,
    {
        files: ['src/**/*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.browser },
        rules: { 'no-unused-vars': ['warn', { args: 'none' }] }
    },
    {
        files: ['*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node }
    }
];
