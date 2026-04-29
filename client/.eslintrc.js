module.exports = {
  root: true,
  extends: '@react-native',
  plugins: ['react-hooks', '@typescript-eslint'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    '@typescript-eslint/no-explicit-any': 'warn',

    'no-console': ['error', { allow: ['warn', 'error'] }],
  },
};