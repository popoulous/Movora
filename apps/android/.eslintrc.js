module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // `void promise;` as a statement is our intentional fire-and-forget marker.
    'no-void': ['error', {allowAsStatement: true}],
  },
};
