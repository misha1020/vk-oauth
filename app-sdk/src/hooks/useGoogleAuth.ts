import { useCallback, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import { authorize as googleAuthorize } from "../../modules/expo-google-sdk";
import { exchangeGoogleJwt } from "../services/api";
import { GOOGLE_WEB_CLIENT_ID } from "../config";

export interface GoogleAuthResult {
  token: string;
}

export function useGoogleAuth(onSuccess: (result: GoogleAuthResult) => void) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const authorize = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      // UUID v4 is 36 chars of uniform-random hex/dash — easily within Google's nonce
      // length cap and uniformly distributed enough for replay protection.
      const nonce = Crypto.randomUUID();

      const result = await googleAuthorize(GOOGLE_WEB_CLIENT_ID, nonce);
      if ("cancelled" in result && result.cancelled) {
        return;
      }

      const { token } = await exchangeGoogleJwt({
        idToken: result.idToken,
        nonce,
      });
      onSuccessRef.current({ token });
    } catch (err: any) {
      setError(err.message || "Google authentication failed");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { authorize, isLoading, error };
}
