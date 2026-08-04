const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
}

const hasFirebaseConfig = Object.values(firebaseConfig).every(Boolean)

export const firebaseReady = hasFirebaseConfig
export const app = null
export const auth = null
export const db = null

let firebaseRuntimePromise = null

export async function loadFirebaseServices() {
  if (!firebaseReady) {
    return { app: null, auth: null, db: null }
  }

  if (!firebaseRuntimePromise) {
    firebaseRuntimePromise = (async () => {
      const [{ initializeApp, getApps }, { getAuth }, { getFirestore }] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore'),
      ])

      const resolvedApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
      return {
        app: resolvedApp,
        auth: getAuth(resolvedApp),
        db: getFirestore(resolvedApp),
      }
    })()
  }

  return firebaseRuntimePromise
}
