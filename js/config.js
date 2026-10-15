// Public configuration. The Google OAuth Client ID is not a secret: it only identifies the app to Google,
// and Google only accepts it from the origins registered in the Cloud console (the GitHub Pages address).
window.App = window.App || {};
window.App.CONFIG = {
  googleClientId: '',
};
