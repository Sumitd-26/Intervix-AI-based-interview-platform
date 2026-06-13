import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_APIKEY,
  authDomain: "intervix-ae6eb.firebaseapp.com",
  projectId: "intervix-ae6eb",
  storageBucket: "intervix-ae6eb.firebasestorage.app",
  messagingSenderId: "551779584883",
  appId: "1:551779584883:web:afecd94576f24d7e975306",
};
const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export { auth, provider };
