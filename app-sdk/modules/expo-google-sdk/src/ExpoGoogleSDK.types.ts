export type GoogleAuthSuccess = {
  cancelled?: false;
  idToken: string;
};

export type GoogleAuthCancelled = {
  cancelled: true;
};

export type GoogleAuthResult = GoogleAuthSuccess | GoogleAuthCancelled;
