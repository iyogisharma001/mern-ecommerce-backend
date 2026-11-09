import admin from "firebase-admin";

// Firebase Admin is used ONLY to verify the ID tokens that the frontend
// gets from Firebase Auth. Credentials come from a service account
// (Firebase console -> Project settings -> Service accounts -> Generate key).
let initialized = false;

export const getFirebaseAuth = () => {
  if (!initialized) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    // .env files store the key on one line with literal "\n"
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey)
      throw new Error(
        "Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in .env"
      );

    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
    initialized = true;
  }
  return admin.auth();
};
