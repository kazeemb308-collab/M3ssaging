// Firebase Web App configuration for Me and You.
// Replace these placeholder values with the config from your Firebase Console.
// This file contains Firebase web identifiers, not server/admin secrets.
export const firebaseConfig = {
  apiKey: 'PASTE_FIREBASE_API_KEY',
  authDomain: 'PASTE_FIREBASE_AUTH_DOMAIN',
  projectId: 'PASTE_FIREBASE_PROJECT_ID',
  storageBucket: 'PASTE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'PASTE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'PASTE_FIREBASE_APP_ID'
};

export const firebaseConfigured = !Object.values(firebaseConfig).some(value =>
  String(value).startsWith('PASTE_')
);
