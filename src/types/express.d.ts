// Adds the authenticated user to Express' Request type
declare global {
  namespace Express {
    interface Request {
      firebaseUser?: {
        uid: string;
        email?: string;
        name?: string;
        picture?: string;
      };
      user?: {
        _id: string;
        role: "admin" | "user";
        name: string;
      };
    }
  }
}

export {};
